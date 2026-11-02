/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Keymap state — the configurator's working copy of the keyboard's layout.
 *
 * The model is the firmware's, not an approximation of it:
 *
 *   - positions are **stock** positions (keeb_keymap.c passes them straight to
 *     ZMK's core, which maps them through the physical layout), so `pos` here
 *     is the same number a keeb_cell carries;
 *   - a binding is a **token plus two params**. There is no "empty cell":
 *     ZMK inheritance is the &trans behavior, and a key that does nothing is
 *     &none. Both are real tokens, so both are written, not omitted;
 *   - layer **slots** and layer **ids** are different things. Add/remove/
 *     reorder shuffle slots (order[slot] = id, 0xff when the slot is empty),
 *     and cell data belongs to the id, not the slot.
 *
 * The firmware is the source of truth: everything on screen comes from a dump,
 * edits are local until committed as one CELLS_SET, and any notification
 * (layer state, cells set, saved, discarded, layer changed) re-reads rather
 * than trusts the local copy.
 *
 * Applying and persisting are two different firmware operations, and only the
 * second one survives a reboot:
 *
 *   - `CELLS_SET` / the layer ops land in ZMK's in-RAM keymap
 *     (`zmk_keymap_set_layer_binding_at_idx`), which is what makes a change
 *     usable immediately and also what makes it evaporate on power loss;
 *   - `SAVE` is what copies the pending changes into ZMK's settings subtree
 *     (`zmk_keymap_save_changes` -> `settings_save_one` -> NVS), which the
 *     firmware re-applies at boot.
 *
 * So the store persists after every successful write by default (`autosave`),
 * and keeps `unsavedWrites` honest when it cannot: a change that reached the
 * keyboard but not its settings is a change that will be lost.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { KEEB_EV_CELLS_SET, KEEB_EV_DISCARDED, KEEB_EV_LAYER_CHANGED, KEEB_EV_LAYER_STATE, KEEB_EV_SAVED } from '../proto/constants.ts'
import { KEEB_TOKEN_NONE, KEEB_TOKEN_UNKNOWN } from '../proto/constants.ts'
import type { Binding, Cell, LayersPayload } from '../proto/types.ts'
import { GRID, GRID_COLS, KEY_COUNT, LAYER_CAPACITY, RESERVED_POSITIONS, STOCK_LAYER_NAMES, TOKENS } from '../proto/zmk.gen.ts'
import { useDeviceStore } from './device.ts'

export const LAYER_ID_INVALID = 0xff

/*
 * The autosave preference is this browser's habit, so it lives in
 * localStorage. It is deliberately not a firmware setting: the firmware's rule
 * is "SAVE is an explicit operation", and that stays the firmware's rule.
 *
 * localStorage is only touched when a window exists - this module is also
 * imported by the SSR smoke render and by the node tests, where it is not.
 */
const AUTOSAVE_KEY = 'keeb.autosave'

const browserSetting = (key: string): string | null => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }

  try {
    return window.localStorage.getItem(key)
  } catch {
    /* Private-mode / disabled storage: the default still applies. */
    return null
  }
}

const writeBrowserSetting = (key: string, value: string): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }

  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* Same: a preference that cannot be remembered falls back to the default. */
  }
}

/** Autosave is on unless this browser has explicitly turned it off. */
const readAutosaveDefault = (): boolean => {
  const stored = browserSetting(AUTOSAVE_KEY)

  return stored === null ? true : stored === '1'
}

const tokenByLabel = (label: string): number => {
  const t = TOKENS.find((x) => x.label === label)

  return t ? t.id : KEEB_TOKEN_UNKNOWN
}

export const TRANSPARENT_TOKEN = tokenByLabel('trans')
export const NONE_TOKEN = tokenByLabel('none')

/**
 * Outcome of a write that may also have been persisted.
 *
 * `ok` is the keyboard's answer to the write; `saved` is the separate answer to
 * "will this survive a reboot". Collapsing them is exactly the confusion this
 * store is trying to remove.
 */
export interface WriteResult {
  ok: boolean
  applied: number
  reason?: string
  /** the write reached the keyboard's settings storage (autosave on and SAVE accepted) */
  saved: boolean
  saveReason?: string
}

export interface SlotView {
  index: number
  id: number
  name: string
  /** the slot holds a layer the keymap file defines, so it can be restored */
  stock: boolean
  live: boolean
  locked: boolean
  dirty: number
}

export const useKeymapStore = defineStore('keymap', () => {
  const device = useDeviceStore()

  const capacity = ref(LAYER_CAPACITY)
  const keyCount = ref(KEY_COUNT)
  /** slot index -> layer id (0xff = empty slot) */
  const order = ref<number[]>(STOCK_LAYER_NAMES.map((_, i) => i))
  const names = ref<Record<number, string>>(Object.fromEntries(STOCK_LAYER_NAMES.map((n, i) => [i, n])))
  /** layer id -> cells, indexed by stock position */
  const cells = ref<Record<number, Cell[]>>({})
  const layerState = ref(0)
  const layerLocked = ref(0)
  /** firmware's highest active layer id, 0xffff when none */
  const activeLayerId = ref(0xffff)
  const editingSlot = ref(0)
  /** layer id -> (position -> pending binding) */
  const dirty = ref<Record<number, Map<number, Binding>>>({})
  const loading = ref(false)
  /** when the keyboard last confirmed a save (KEEB_EV_SAVED), for the UI */
  const savedAt = ref(0)
  /** persist a write to the keyboard's settings as soon as it lands */
  const autosave = ref(readAutosaveDefault())
  /**
   * Writes that reached the keyboard's RAM but not its settings.
   * A count of cells for `CELLS_SET`, one per layer operation - the unit is
   * "firmware operations that still need a SAVE", not ZMK's per-binding
   * pending bits, which the protocol does not expose.
   */
  const unsavedWrites = ref(0)

  const reserved = new Set<number>(RESERVED_POSITIONS)
  const isReserved = (pos: number): boolean => reserved.has(pos)

  /* ---------------------------------------------------------------- views */

  const slots = computed<SlotView[]>(() =>
    order.value.slice(0, capacity.value).map((id, index) => ({
      index,
      id,
      name: id === LAYER_ID_INVALID ? '' : (names.value[id] ?? `L${id}`),
      stock: id !== LAYER_ID_INVALID && id < STOCK_LAYER_NAMES.length,
      live: id !== LAYER_ID_INVALID && (layerState.value & (1 << id)) !== 0,
      locked: id !== LAYER_ID_INVALID && (layerLocked.value & (1 << id)) !== 0,
      dirty: dirty.value[id]?.size ?? 0,
    })),
  )

  const editableSlots = computed(() => slots.value.filter((s) => s.id !== LAYER_ID_INVALID))
  const editingId = computed(() => order.value[editingSlot.value] ?? LAYER_ID_INVALID)
  const editingName = computed(() => (names.value[editingId.value] ?? ''))
  const dirtyTotal = computed(() => Object.values(dirty.value).reduce((n, m) => n + m.size, 0))
  const isDirty = computed(() => dirtyTotal.value > 0)
  /** True when the keyboard is holding a change that a reboot would drop. */
  const hasUnsaved = computed(() => unsavedWrites.value > 0)

  /** Layer name by id, for rendering MO/LT caps. */
  const layerName = (id: number): string => names.value[id] ?? `#${id}`

  const tokenName = (token: number): string => {
    if (token === KEEB_TOKEN_NONE) {
      return 'unmapped'
    }
    if (token === KEEB_TOKEN_UNKNOWN) {
      return 'not configurable'
    }

    const live = device.tokens.find((t) => t.token === token)
    const def = TOKENS.find((t) => t.id === token)

    return live?.name ?? def?.name ?? `token ${token}`
  }

  const tokenLabel = (token: number): string => {
    const def = TOKENS.find((t) => t.id === token)

    return def ? `&${def.label}` : tokenName(token)
  }

  const tokenDef = (token: number) => TOKENS.find((t) => t.id === token) ?? null

  /* ---------------------------------------------------------------- ingest */

  function applyLayers(p: LayersPayload): void {
    capacity.value = p.count
    order.value = p.order.length ? [...p.order] : order.value
    activeLayerId.value = p.active
    layerState.value = p.state
    layerLocked.value = p.locked

    for (const [id, name] of Object.entries(p.names ?? {})) {
      names.value[Number(id)] = name
    }

    /* A slot that stopped existing must stop being the edited one. */
    if (editingSlot.value >= capacity.value) {
      editingSlot.value = capacity.value - 1
    }
  }

  function applyCells(layerId: number, list: Cell[]): void {
    cells.value[layerId] = list.map((c) => ({ ...c }))
  }

  function cellList(layerId: number): Cell[] {
    return cells.value[layerId] ?? []
  }

  /* ---------------------------------------------------------------- reads */

  async function loadAll(): Promise<void> {
    loading.value = true

    try {
      applyLayers(await device.readLayers())

      for (const id of order.value.filter((i) => i !== LAYER_ID_INVALID)) {
        await device.readLayerCells(id, (dump) => applyCells(dump.layer, dump.cells))
      }

      dirty.value = {}
      /* The keyboard's own state is now the model's state. NB this is a local
       * baseline, not a report from the firmware: ZMK's per-binding pending
       * bits are not in the protocol, so a keyboard that still holds unsaved
       * edits from an earlier session reads back as "no unsaved changes".
       */
      unsavedWrites.value = 0
    } finally {
      loading.value = false
    }
  }

  async function refreshLayer(layerId: number): Promise<void> {
    await device.readLayerCells(layerId, (dump) => applyCells(dump.layer, dump.cells))
  }

  /** The cell as the edited slot itself defines it (no inheritance walk). */
  function ownCell(slot: number, pos: number): Cell | null {
    const id = order.value[slot]

    if (id === LAYER_ID_INVALID) {
      return null
    }

    return cellList(id)[pos] ?? null
  }

  /** ZMK's resolution: a &trans binding falls to the next lower slot, all the
   * way to slot 0. Returns the binding and the slot it came from. */
  function resolve(slot: number, pos: number): { binding: Cell; fromSlot: number } | null {
    for (let s = slot; s >= 0; s--) {
      const id = order.value[s]

      if (id === LAYER_ID_INVALID) {
        continue
      }

      const cell = cellList(id)[pos]

      if (!cell) {
        continue
      }

      if (cell.token === TRANSPARENT_TOKEN) {
        continue
      }

      return { binding: cell, fromSlot: s }
    }

    return null
  }

  /* ---------------------------------------------------------------- edits */

  function setBinding(slot: number, pos: number, binding: Binding): { ok: boolean; reason?: string } {
    const id = order.value[slot]

    if (id === LAYER_ID_INVALID) {
      return { ok: false, reason: 'slot is empty' }
    }

    /* The firmware refuses these outright; refusing locally is a courtesy,
     * the real rule is enforced in keeb_keymap.c and cannot be talked out of. */
    if (isReserved(pos)) {
      return { ok: false, reason: 'reserved position — the firmware will not rebind it' }
    }

    const list = cellList(id)

    if (!list[pos] && list.length) {
      return { ok: false, reason: 'this grid slot has no key position' }
    }

    const next: Cell = { pos, token: binding.token, param1: binding.param1, param2: binding.param2, flags: 0 }

    if (!cells.value[id]) {
      cells.value[id] = list
    }

    list[pos] = next

    const layerDirty = dirty.value[id] ?? new Map<number, Binding>()

    layerDirty.set(pos, { token: binding.token, param1: binding.param1, param2: binding.param2 })
    dirty.value[id] = layerDirty

    return { ok: true }
  }

  /** Inherit = bind &trans. Disabling a key = bind &none. Both are real
   * writes, because the firmware has no notion of an absent binding. */
  const makeTransparent = (slot: number, pos: number) => setBinding(slot, pos, { token: TRANSPARENT_TOKEN, param1: 0, param2: 0 })
  const makeDisabled = (slot: number, pos: number) => setBinding(slot, pos, { token: NONE_TOKEN, param1: 0, param2: 0 })

  /**
   * Unstage one cell.
   *
   * The staged value overwrote the local copy of the keyboard's cell, so the
   * only honest way back is to ask the keyboard what it has - which is also what
   * `revertEdits` does for a whole layer. The rest of the layer's staged edits
   * are re-applied on top of the answer, because dropping one key must not
   * quietly drop the others.
   */
  async function revertCell(slot: number, pos: number): Promise<{ ok: boolean; reason?: string }> {
    const id = order.value[slot]

    if (id === LAYER_ID_INVALID) {
      return { ok: false, reason: 'slot is empty' }
    }

    const pending = dirty.value[id]

    if (!pending?.has(pos)) {
      return { ok: false, reason: 'nothing staged at this position' }
    }

    pending.delete(pos)

    if (pending.size === 0) {
      dropDirty(id)
    }

    if (device.connected) {
      await refreshLayer(id)
    }

    const list = cellList(id)

    for (const [p, b] of pending.entries()) {
      list[p] = { pos: p, token: b.token, param1: b.param1, param2: b.param2, flags: 0 }
    }

    return { ok: true }
  }

  function dropDirty(layerId: number): void {
    delete dirty.value[layerId]
  }

  /** True when this position holds an edit that has not been written yet. */
  function isPending(slot: number, pos: number): boolean {
    const id = order.value[slot]

    return id !== LAYER_ID_INVALID && (dirty.value[id]?.has(pos) ?? false)
  }

  /** Throw away every local edit and show the keyboard's layout again.
   * Nothing these edits did ever reached the firmware - that is what staging
   * them means - so this is a reload, not an undo over the wire.
   */
  async function revertEdits(): Promise<number> {
    const ids = Object.keys(dirty.value).map(Number)
    const count = dirtyTotal.value

    dirty.value = {}

    if (ids.length && device.connected) {
      for (const id of ids) {
        await refreshLayer(id)
      }
    }

    return count
  }

  /** One CELLS_SET per layer: the firmware validates the whole record before
   * applying any of it, so a rejected commit leaves the layout untouched and
   * the pending edits stay pending. This is the RAM half only - `commitLayer`
   * and `commitAll` are the ones that also persist.
   */
  async function commitCells(slot: number): Promise<{ ok: boolean; applied: number; reason?: string }> {
    const id = order.value[slot]

    if (id === LAYER_ID_INVALID) {
      return { ok: false, applied: 0, reason: 'slot is empty' }
    }

    const pending = dirty.value[id]

    if (!pending || pending.size === 0) {
      return { ok: true, applied: 0 }
    }

    if (!device.writable) {
      return { ok: false, applied: 0, reason: 'no writable keyboard connected' }
    }

    const entries = [...pending.entries()].map(([pos, b]) => ({ pos, ...b }))

    try {
      const ack = await device.writeCells(id, entries)

      dropDirty(id)
      await refreshLayer(id)

      return { ok: true, applied: ack.detail }
    } catch (err) {
      return { ok: false, applied: 0, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Remember that the keyboard now holds a change its settings do not have. */
  function markUnsaved(count: number): void {
    unsavedWrites.value += count
  }

  /**
   * Send SAVE when autosave is on and something is pending.
   *
   * Never throws, and a failed persist leaves `unsavedWrites` set: a write the
   * settings do not have is a write a reboot will drop, and the UI has to keep
   * saying so rather than report success.
   */
  async function persistAfterWrite(): Promise<{ saved: boolean; reason?: string }> {
    if (unsavedWrites.value === 0 || !autosave.value) {
      return { saved: false }
    }

    if (!device.writable) {
      return { saved: false, reason: 'no writable keyboard - the change is live but not saved' }
    }

    try {
      await device.save()

      /* The ACK is the confirmation; KEEB_EV_SAVED is the same fact a second
       * time, and a dropped notification must not leave the UI claiming the
       * layout is unpersisted.
       */
      unsavedWrites.value = 0
      savedAt.value = Date.now()

      return { saved: true }
    } catch (err) {
      return { saved: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Commit one layer as one CELLS_SET, then persist it when autosave is on. */
  async function commitLayer(slot = editingSlot.value): Promise<WriteResult> {
    const r = await commitCells(slot)

    if (!r.ok || r.applied === 0) {
      return { ...r, saved: false }
    }

    markUnsaved(r.applied)

    const p = await persistAfterWrite()

    return { ...r, saved: p.saved, saveReason: p.reason }
  }

  async function commitAll(): Promise<WriteResult> {
    let applied = 0
    let failure: string | undefined

    for (const slot of editableSlots.value.map((s) => s.index)) {
      const r = await commitCells(slot)

      if (!r.ok) {
        failure = r.reason
        break
      }

      applied += r.applied
    }

    /* Layers that did land before a rejected one are live in the keyboard,
     * so they count as unsaved too rather than vanishing from the report.
     */
    if (applied > 0) {
      markUnsaved(applied)

      const p = await persistAfterWrite()

      return { ok: !failure, applied, reason: failure, saved: p.saved, saveReason: p.reason }
    }

    return { ok: !failure, applied, reason: failure, saved: false }
  }

  /* ---------------------------------------------------------------- layer ops */

  /** A layer operation is persisted by the same SAVE a cell write uses: ZMK
   * saves the layer order and the layer names in the same "keymap" settings
   * subtree, so a rename or a reorder that is never saved disappears on reboot
   * exactly like a rebound key does.
   */
  async function afterLayerOp(): Promise<{ saved: boolean; reason?: string }> {
    markUnsaved(1)

    return persistAfterWrite()
  }

  async function renameLayer(index: number, name: string): Promise<WriteResult> {
    const id = order.value[index]

    if (id === LAYER_ID_INVALID) {
      return { ok: false, applied: 0, reason: 'slot is empty', saved: false }
    }

    const clean = name.trim().slice(0, 20)

    try {
      await device.renameLayer(id, clean)
      names.value[id] = clean
      await device.readLayers().then(applyLayers)

      const p = await afterLayerOp()

      return { ok: true, applied: 1, saved: p.saved, saveReason: p.reason }
    } catch (err) {
      return { ok: false, applied: 0, reason: err instanceof Error ? err.message : String(err), saved: false }
    }
  }

  async function moveLayer(from: number, to: number): Promise<WriteResult> {
    try {
      await device.moveLayer(from, to)
      applyLayers(await device.readLayers())

      const p = await afterLayerOp()

      return { ok: true, applied: 1, saved: p.saved, saveReason: p.reason }
    } catch (err) {
      return { ok: false, applied: 0, reason: err instanceof Error ? err.message : String(err), saved: false }
    }
  }

  async function addLayer(): Promise<WriteResult & { index?: number }> {
    try {
      const ack = await device.addLayer()
      applyLayers(await device.readLayers())

      const p = await afterLayerOp()

      return { ok: true, applied: 1, index: ack.detail, saved: p.saved, saveReason: p.reason }
    } catch (err) {
      return { ok: false, applied: 0, reason: err instanceof Error ? err.message : String(err), saved: false }
    }
  }

  async function removeLayer(index: number): Promise<WriteResult> {
    try {
      await device.removeLayer(index)
      applyLayers(await device.readLayers())

      const p = await afterLayerOp()

      return { ok: true, applied: 1, saved: p.saved, saveReason: p.reason }
    } catch (err) {
      return { ok: false, applied: 0, reason: err instanceof Error ? err.message : String(err), saved: false }
    }
  }

  async function restoreLayer(id: number, index: number): Promise<WriteResult> {
    try {
      await device.restoreLayer(id, index)
      applyLayers(await device.readLayers())
      await refreshLayer(id)

      const p = await afterLayerOp()

      return { ok: true, applied: 1, saved: p.saved, saveReason: p.reason }
    } catch (err) {
      return { ok: false, applied: 0, reason: err instanceof Error ? err.message : String(err), saved: false }
    }
  }

  /* ---------------------------------------------------------------- events */

  /** Follow the keyboard's own notifications.
   *
   * The store owns this rather than any component: a layer change while someone
   * is typing, or a discard from the revert chord, has to move the model even
   * when nothing on screen asked for it. */
  function bindEvents(): () => void {
    return device.onEvent((e) => {
      switch (e.event) {
        case KEEB_EV_LAYER_STATE:
          layerState.value = e.data.length >= 4 ? new DataView(e.data.buffer, e.data.byteOffset).getUint32(0, true) : 0
          break

        case KEEB_EV_CELLS_SET:
          void refreshLayer(e.data[0] ?? 0)
          break

        case KEEB_EV_DISCARDED:
          /* The keyboard dropped what it had not saved; anything it had saved
           * is still what it says it is.
           */
          unsavedWrites.value = 0
          void loadAll()
          break

        case KEEB_EV_LAYER_CHANGED:
          void device.readLayers().then(applyLayers)
          break

        case KEEB_EV_SAVED:
          savedAt.value = Date.now()
          unsavedWrites.value = 0
          break

        default:
          break
      }
    })
  }

  /* ---------------------------------------------------------------- persistence */

  /** Turn autosave on or off for this browser. */
  function setAutosave(on: boolean): void {
    autosave.value = on
    writeBrowserSetting(AUTOSAVE_KEY, on ? '1' : '0')
  }

  async function save(): Promise<{ ok: boolean; reason?: string }> {
    try {
      await device.save()

      unsavedWrites.value = 0
      savedAt.value = Date.now()

      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  async function discard(): Promise<{ ok: boolean; reason?: string }> {
    try {
      await device.discard()
      await loadAll()

      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  async function resetSettings(): Promise<{ ok: boolean; reason?: string }> {
    try {
      await device.reset()
      await loadAll()

      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  return {
    capacity, keyCount, order, names, cells, layerState, layerLocked, activeLayerId, savedAt,
    autosave, unsavedWrites, hasUnsaved,
    editingSlot, editingId, editingName, slots, editableSlots, dirtyTotal, isDirty, loading,
    isReserved, layerName, tokenName, tokenLabel, tokenDef, isPending,
    applyLayers, applyCells, cellList, loadAll, refreshLayer, ownCell, resolve,
    setBinding, makeTransparent, makeDisabled, commitLayer, commitAll, dropDirty, revertEdits, revertCell,
    renameLayer, moveLayer, addLayer, removeLayer, restoreLayer,
    save, discard, resetSettings, setAutosave, persistAfterWrite, bindEvents,
  }
})

/* ---------------------------------------------------------------- grid view */

/*
 * Where a position sits on the keyboard, straight out of the matrix transform.
 *
 * The transform's `map` is written in the order the keys are physically laid
 * out, so the position number a CELLS record carries already says where the
 * key is — but only if the view reads the map the way the firmware does:
 *
 *   left half   cols 0..5  listed outer edge -> split gap
 *   right half  cols 11..6 listed split gap  -> outer edge (col-offset 6)
 *
 * Sorting each half by column number flips the right half: it would put the
 * outer top-right corner (position 11, col 6) next to the gap. So a half is
 * drawn by *slot inside the half*, and the right half's slot counts back from
 * its outer edge. That is also what makes the transform's mirror rule read
 * correctly: the mirror of global col c is 11 - c, and mirrored keys land in
 * the same slot of their own half.
 */
export const GRID_ROWS = Math.max(...GRID.map((g) => g.row)) + 1
export const HALF_COLS = GRID_COLS / 2

export interface GridSlot {
  /** null when this grid slot has no switch, i.e. no key position exists */
  pos: number | null
  /** the transform's global column, 0-11, for tooltips */
  col: number
  row: number
}

/** One half of one matrix row, in the order it is drawn on screen. */
export const gridHalf = (row: number, side: 'L' | 'R'): GridSlot[] =>
  Array.from({ length: HALF_COLS }, (_, slot) => {
    const col = side === 'L' ? slot : GRID_COLS - 1 - slot
    const cell = GRID.find((g) => g.row === row && g.col === col)

    return { pos: cell?.pos ?? null, col, row }
  })
