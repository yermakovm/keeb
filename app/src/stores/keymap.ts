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
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { KEEB_EV_CELLS_SET, KEEB_EV_DISCARDED, KEEB_EV_LAYER_CHANGED, KEEB_EV_LAYER_STATE, KEEB_EV_SAVED } from '../proto/constants.ts'
import { KEEB_TOKEN_NONE, KEEB_TOKEN_UNKNOWN } from '../proto/constants.ts'
import type { Binding, Cell, LayersPayload } from '../proto/types.ts'
import { GRID, KEY_COUNT, LAYER_CAPACITY, RESERVED_POSITIONS, STOCK_LAYER_NAMES, TOKENS } from '../proto/zmk.gen.ts'
import { useDeviceStore } from './device.ts'

export const LAYER_ID_INVALID = 0xff

const tokenByLabel = (label: string): number => {
  const t = TOKENS.find((x) => x.label === label)

  return t ? t.id : KEEB_TOKEN_UNKNOWN
}

export const TRANSPARENT_TOKEN = tokenByLabel('trans')
export const NONE_TOKEN = tokenByLabel('none')

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

  function dropDirty(layerId: number): void {
    delete dirty.value[layerId]
  }

  /** One CELLS_SET per layer: the firmware validates the whole record before
   * applying any of it, so a rejected commit leaves the layout untouched and
   * the pending edits stay pending. */
  async function commitLayer(slot = editingSlot.value): Promise<{ ok: boolean; applied: number; reason?: string }> {
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

  async function commitAll(): Promise<{ ok: boolean; applied: number; reason?: string }> {
    let applied = 0

    for (const slot of editableSlots.value.map((s) => s.index)) {
      const r = await commitLayer(slot)

      if (!r.ok) {
        return r
      }

      applied += r.applied
    }

    return { ok: true, applied }
  }

  /* ---------------------------------------------------------------- layer ops */

  async function renameLayer(index: number, name: string): Promise<{ ok: boolean; reason?: string }> {
    const id = order.value[index]

    if (id === LAYER_ID_INVALID) {
      return { ok: false, reason: 'slot is empty' }
    }

    const clean = name.trim().slice(0, 20)

    try {
      await device.renameLayer(id, clean)
      names.value[id] = clean
      await device.readLayers().then(applyLayers)

      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  async function moveLayer(from: number, to: number): Promise<{ ok: boolean; reason?: string }> {
    try {
      await device.moveLayer(from, to)
      applyLayers(await device.readLayers())

      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  async function addLayer(): Promise<{ ok: boolean; index?: number; reason?: string }> {
    try {
      const ack = await device.addLayer()
      applyLayers(await device.readLayers())

      return { ok: true, index: ack.detail }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  async function removeLayer(index: number): Promise<{ ok: boolean; reason?: string }> {
    try {
      await device.removeLayer(index)
      applyLayers(await device.readLayers())

      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  async function restoreLayer(id: number, index: number): Promise<{ ok: boolean; reason?: string }> {
    try {
      await device.restoreLayer(id, index)
      applyLayers(await device.readLayers())
      await refreshLayer(id)

      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
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
          void loadAll()
          break

        case KEEB_EV_LAYER_CHANGED:
          void device.readLayers().then(applyLayers)
          break

        case KEEB_EV_SAVED:
          savedAt.value = Date.now()
          break

        default:
          break
      }
    })
  }

  /* ---------------------------------------------------------------- persistence */

  async function save(): Promise<{ ok: boolean; reason?: string }> {
    try {
      await device.save()

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
    editingSlot, editingId, editingName, slots, editableSlots, dirtyTotal, isDirty, loading,
    isReserved, layerName, tokenName, tokenLabel, tokenDef,
    applyLayers, applyCells, cellList, loadAll, refreshLayer, ownCell, resolve,
    setBinding, makeTransparent, makeDisabled, commitLayer, commitAll, dropDirty,
    renameLayer, moveLayer, addLayer, removeLayer, restoreLayer,
    save, discard, resetSettings, bindEvents,
  }
})

/** Grid helpers shared by the views: stock position -> where it renders. */
export const GRID_ROWS = Math.max(...GRID.map((g) => g.row)) + 1
export const gridRow = (row: number) => GRID.filter((g) => g.row === row)
export const gridSide = (row: number, side: 'L' | 'R') =>
  gridRow(row).filter((g) => g.side === side).sort((a, b) => a.col - b.col)
