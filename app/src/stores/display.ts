/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Panel state — the configurator's working copy of the status screen.
 *
 * The model is the firmware's (keeb-module/boards/shields/keeb/ui/widget_model.c
 * + display/keeb_display.c):
 *
 *   - the panel is a **bounded table of drawing primitives**, not an LVGL
 *     widget tree. Every entry is `{kind, source, x, y, w, h, style}` in the
 *     logical UI space, which is the panel's size only when rotation is 0;
 *   - a widget names a **source**, and the firmware reads that value from ZMK
 *     at draw time. Layer, battery, link, charging and the connected device are
 *     the keyboard's to report — the editor moves them, it never sets them;
 *   - the only values a host may write are the **text slots** and **value
 *     slots**, and only the widget that points at them shows them;
 *   - the limits (widget count, slot count, slot length, which kinds are
 *     drawable) come from DISPLAY_INFO, never from a table this app was
 *     generated with — the panel is not in devicetree, so there is nothing to
 *     generate it from.
 *
 * Applying and persisting are two firmware operations, exactly as in the
 * keymap store: DISPLAY_SET lands in the running panel and dies with System OFF,
 * DISPLAY_SAVE is what survives a reboot. So edits are local until Apply, and
 * Apply is not Save.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  KEEB_SRC_BATT_LEFT,
  KEEB_SRC_BATT_RIGHT,
  KEEB_SRC_LAYER_ART,
  KEEB_SRC_LAYER_PIPS,
  KEEB_SRC_PROFILE_PIPS,
  KEEB_SRC_RSSI,
  KEEB_SRC_NONE,
  KEEB_DISPLAY_INFO_F_ART,
  KEEB_DISPLAY_F_DIRTY,
  KEEB_PIPS_GEOMETRY,
  KEEB_EV_DISPLAY_SAVED,
  KEEB_EV_DISPLAY_SET,
  KEEB_EV_PEER_DISPLAY_SAVED,
  KEEB_EV_PEER_DISPLAY_SET,
  KEEB_EV_TEXT_SET,
  KEEB_SRC_TEXT_BASE,
  KEEB_SRC_VALUE_BASE,
  KEEB_WID_ART,
  KEEB_WID_BAR,
  KEEB_WID_BONGO,
  KEEB_WID_BATTERY,
  KEEB_WID_PIPS,
  KEEB_WID_TEXT,
  KEEB_PRESET_CUSTOM,
} from '../proto/constants.ts'
import type { DisplayInfoPayload, DisplayTablePayload, Widget } from '../proto/types.ts'
import { useDeviceStore } from './device.ts'
import type { PanelTarget } from './device.ts'

/** A new widget, placed where the user can see it and edit it immediately. */
const blankWidget = (): Widget => ({ kind: KEEB_WID_TEXT, source: KEEB_SRC_TEXT_BASE, x: 4, y: 4, w: 40, h: 0, style: 0 })

/*
 * Two panels, one editor. The store is a factory because the half holding the
 * link and the other half are independent tables with independent apply/save
 * state, and a component should be able to hold either without knowing which
 * wire records it ends up using.
 */
function definePanelStore(id: string, target: PanelTarget) {
  return defineStore(id, () => {
  const device = useDeviceStore()

  const info = ref<DisplayInfoPayload | null>(null)
  const widgets = ref<Widget[]>([])
  const texts = ref<Record<number, string>>({})
  const values = ref<Record<number, number>>({})
  const preset = ref(KEEB_PRESET_CUSTOM)
  /** what the keyboard last reported in keeb_display_hdr.flags */
  const deviceDirty = ref(false)
  const loaded = ref(false)
  const loading = ref(false)
  const lastError = ref('')
  const savedAt = ref('')

  /* `editable` is a boolean on the wire (DISPLAY_INFO says whether this half
   * accepts panel writes), and `writable` is the session's rule: a read-only
   * link can read the panel but not redraw it. */
  const selectedWidget = ref(0)

  const canEdit = computed(() => (info.value?.editable ?? false) && device.writable)
  const canDrawArt = computed(() => (((info.value?.flags ?? 0) & KEEB_DISPLAY_INFO_F_ART) !== 0))
  const logicalW = computed(() => info.value?.logicalW ?? 0)
  const logicalH = computed(() => info.value?.logicalH ?? 0)
  const widgetMax = computed(() => info.value?.widgetMax ?? 0)
  const textSlots = computed(() => info.value?.textSlots ?? 0)
  const valueSlots = computed(() => info.value?.valueSlots ?? 0)
  const textMax = computed(() => info.value?.textMax ?? 0)
  /* A pip row is as wide as the keymap has layers, and the firmware says how
   * many that is rather than leaving the configurator to guess. */
  const layerCount = computed(() => info.value?.layers ?? 0)

  const hasLocalEdits = ref(false)
  const unsavedWrites = ref(false)

  const statusLine = computed(() => {
    if (!loaded.value) {
      return 'panel not read yet'
    }

    const where = `${logicalW.value}x${logicalH.value} logical, rotated ${info.value?.rotation ?? 0}° into ${info.value?.panelW ?? 0}x${info.value?.panelH ?? 0}`
    const state = unsavedWrites.value
      ? 'applied, not saved'
      : deviceDirty.value
        ? 'keyboard reports unsaved changes'
        : 'saved'

    return `${widgets.value.length}/${widgetMax.value} widgets · ${where} · ${state}`
  })

  /* ---------------------------------------------------------------- validation
   *
   * Mirrors keeb_ui_validate_widget so the editor refuses locally what the
   * firmware would refuse remotely: an unknown kind/source, a kind fed by a
   * source that cannot feed it, or geometry outside the panel. */

  function sourceKnown(source: number): boolean {
    /* 0..KEEB_SRC_RSSI is the firmware's enum (keeb_ui_validate_widget's
     * source_known); the value slots start at 0x40 and the text slots at 0x20. */
    if (source >= 0 && source <= KEEB_SRC_RSSI) {
      return true
    }

    if (source >= KEEB_SRC_TEXT_BASE && source < KEEB_SRC_TEXT_BASE + textSlots.value) {
      return true
    }

    return source >= KEEB_SRC_VALUE_BASE && source < KEEB_SRC_VALUE_BASE + valueSlots.value
  }

  function kindSourceOk(w: Widget): boolean {
    const valueBase = KEEB_SRC_VALUE_BASE

    switch (w.kind) {
      case KEEB_WID_TEXT:
        /* A text widget prints something. A percentage is a bar's business,
         * pips and artwork are not text. */
        return (
          w.source !== KEEB_SRC_NONE &&
          w.source !== KEEB_SRC_LAYER_PIPS &&
          w.source !== KEEB_SRC_LAYER_ART &&
          w.source !== KEEB_SRC_BATT_LEFT &&
          w.source !== KEEB_SRC_BATT_RIGHT &&
          w.source !== KEEB_SRC_PROFILE_PIPS &&
          w.source !== KEEB_SRC_RSSI
        )
      case KEEB_WID_BAR:
      case KEEB_WID_BATTERY:
        return (
          w.source === KEEB_SRC_BATT_LEFT ||
          w.source === KEEB_SRC_BATT_RIGHT ||
          w.source === KEEB_SRC_RSSI ||
          (w.source >= valueBase && w.source < valueBase + valueSlots.value)
        )
      case KEEB_WID_PIPS:
        return w.source === KEEB_SRC_LAYER_PIPS || w.source === KEEB_SRC_PROFILE_PIPS
      case KEEB_WID_ART:
        return w.source === KEEB_SRC_LAYER_ART && canDrawArt.value
      default:
        return w.source === KEEB_SRC_NONE
    }
  }

  /** 0 when the widget is drawable here, otherwise a human-readable reason. */
  function validate(w: Widget): string {
    if (w.kind >= (info.value?.kindMax ?? 10)) {
      return 'this firmware does not know that widget kind'
    }

    /* The cat's frames are linked on the peripheral only, which is the other
     * half's panel - not the one this link is attached to. */
    if (target === 0 && w.kind === KEEB_WID_BONGO) {
      return 'the cat is drawn on the other half'
    }

    if (!sourceKnown(w.source)) {
      return 'unknown source'
    }

    if (!kindSourceOk(w)) {
      return 'that kind cannot be fed by that source'
    }

    if (w.kind === KEEB_WID_ART && !canDrawArt.value) {
      return 'this half does not link the artwork (CONFIG_KEEB_UI_CENTRAL_ART)'
    }

    if (w.x >= logicalW.value || w.y >= logicalH.value) {
      return 'origin is outside the panel'
    }

    if (w.x + w.w > logicalW.value || w.y + w.h > logicalH.value) {
      return 'the box runs off the panel'
    }

    if (w.kind === KEEB_WID_PIPS) {
      const gap = KEEB_PIPS_GEOMETRY[w.style]?.gap ?? 2

      if (w.x + layerCount.value * (w.w + gap) > logicalW.value) {
        return `the row of ${layerCount.value} pips runs off the panel`
      }
    }

    return ''
  }

  const problems = computed(() =>
    widgets.value
      .map((w, i) => ({ i, why: validate(w) }))
      .filter((p) => p.why !== ''),
  )

  /* ---------------------------------------------------------------- reads */

  function adopt(table: DisplayTablePayload): void {
    widgets.value = table.widgets.map((w) => ({ ...w }))
    texts.value = { ...table.texts }
    values.value = { ...table.values }
    preset.value = table.preset
    deviceDirty.value = (table.flags & KEEB_DISPLAY_F_DIRTY) !== 0
    loaded.value = true
    hasLocalEdits.value = false
  }

  async function load(): Promise<void> {
    loading.value = true
    lastError.value = ''

    try {
      info.value = await device.readDisplayInfo(target)

      adopt(await device.readDisplay(target))
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      loaded.value = false
    } finally {
      loading.value = false
    }
  }

  /**
   * Re-read the keyboard's panel.
   *
   * Staged local edits survive a re-read unless it is forced: the keyboard
   * sends a DISPLAY_SET notification of its own accord (and this app's writes
   * trigger one), and a re-read that adopted over the top of what the user is
   * arranging would throw their work away before they ever applied it.
   */
  async function reload(force = false): Promise<void> {
    /* A peer event can arrive before this panel was ever opened; there are no
     * limits to lay its table out against yet, so leave the read for load(). */
    if (!info.value) {
      return
    }

    if (hasLocalEdits.value && !force) {
      return
    }

    try {
      adopt(await device.readDisplay(target))
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    }
  }

  /* ---------------------------------------------------------------- local edits */

  function edit(index: number, patch: Partial<Widget>): string {
    const next = { ...widgets.value[index], ...patch }
    const why = validate(next)

    if (why) {
      lastError.value = why
      return why
    }

    widgets.value = widgets.value.map((w, i) => (i === index ? next : w))
    hasLocalEdits.value = true
    lastError.value = ''

    return ''
  }

  function addWidget(): string {
    if (widgets.value.length >= widgetMax.value) {
      const why = `this panel holds ${widgetMax.value} widgets`

      lastError.value = why

      return why
    }

    const w = { ...blankWidget(), source: KEEB_SRC_TEXT_BASE + pickTextSlot(widgets.value.length) }
    const why = validate(w)

    if (why) {
      lastError.value = why

      return why
    }

    widgets.value = [...widgets.value, w]
    hasLocalEdits.value = true

    return ''
  }

  function removeWidget(index: number): void {
    widgets.value = widgets.value.filter((_, i) => i !== index)
    hasLocalEdits.value = true
  }

  /** The text slot a widget should hold its own string in, picked here so the
   * editor never asks the user for a slot number: the lowest one no other
   * widget is using, or the least-used one when all of them are taken. */
  function pickTextSlot(index: number): number {
    const used = new Array(textSlots.value).fill(0)

    widgets.value.forEach((w, i) => {
      const slot = w.source - KEEB_SRC_TEXT_BASE

      if (i !== index && slot >= 0 && slot < textSlots.value) {
        used[slot]++
      }
    })

    const free = used.findIndex((n) => n === 0)

    return free >= 0 ? free : used.indexOf(Math.min(...used))
  }

  /** Point a text widget at a slot of its own. Returns '' or the reason it was refused. */
  function useTextSlot(index: number): string {
    return edit(index, { source: KEEB_SRC_TEXT_BASE + pickTextSlot(index) })
  }

  function moveWidget(index: number, to: number): void {
    if (to < 0 || to >= widgets.value.length || to === index) {
      return
    }

    const next = widgets.value.map((w) => ({ ...w }))
    const [moved] = next.splice(index, 1)

    next.splice(to, 0, moved)
    widgets.value = next
    hasLocalEdits.value = true
  }

  function dropLocalEdits(): void {
    hasLocalEdits.value = false
    void reload()
  }

  /* ---------------------------------------------------------------- writes */

  type WriteResult = { ok: boolean; reason?: string }

  async function runWrite(fn: () => Promise<unknown>): Promise<WriteResult> {
    try {
      await fn()
      lastError.value = ''

      return { ok: true }
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)

      return { ok: false, reason: lastError.value }
    }
  }

  /** One DISPLAY_SET: the whole table, validated in full by the firmware. */
  async function applyTable(): Promise<WriteResult> {
    if (!hasLocalEdits.value) {
      lastError.value = 'nothing staged to apply'

      return { ok: false, reason: lastError.value }
    }

    const bad = problems.value[0]

    if (bad) {
      lastError.value = `widget ${bad.i + 1}: ${bad.why}`

      return { ok: false, reason: lastError.value }
    }

    const wrote = await runWrite(() => device.writeDisplay(widgets.value, target))

    if (!wrote.ok) {
      return wrote
    }

    unsavedWrites.value = true
    hasLocalEdits.value = false

    await reload(true)

    return wrote
  }

  async function setTextSlot(slot: number, text: string): Promise<WriteResult> {
    /* The firmware's limit is bytes, not characters — the panel's fonts carry
     * the ASCII range, so counting code units here would let a multi-byte name
     * through and have the keyboard refuse it. */
    if (new TextEncoder().encode(text).length > textMax.value) {
      lastError.value = `text is limited to ${textMax.value} bytes`

      return { ok: false, reason: lastError.value }
    }

    const wrote = await runWrite(() => device.writeText(slot, text, target))

    if (wrote.ok) {
      unsavedWrites.value = true
      await reload(true)
    }

    return wrote
  }

  /** Value slots are live only: the firmware never persists them. The peer
   * panel does not relay them, which is why its DISPLAY_INFO reports zero. */
  async function setValueSlot(slot: number, value: number): Promise<WriteResult> {
    if (target === 1) {
      lastError.value = 'live value slots are not relayed to the other half'

      return { ok: false, reason: lastError.value }
    }

    const wrote = await runWrite(() => device.writeValue(slot, value))

    if (wrote.ok) {
      await reload(true)
    }

    return wrote
  }

  async function save(): Promise<WriteResult> {
    const wrote = await runWrite(() => device.displaySave(target))

    if (wrote.ok) {
      unsavedWrites.value = false
      deviceDirty.value = false
      savedAt.value = new Date().toLocaleTimeString()
    }

    return wrote
  }

  async function discard(): Promise<WriteResult> {
    const wrote = await runWrite(() => device.displayDiscard(target))

    if (wrote.ok) {
      unsavedWrites.value = false
      hasLocalEdits.value = false
      await reload(true)
    }

    return wrote
  }

  async function resetStorage(): Promise<WriteResult> {
    const wrote = await runWrite(() => device.displayReset(target))

    if (wrote.ok) {
      unsavedWrites.value = false
      hasLocalEdits.value = false
      await reload(true)
    }

    return wrote
  }

  async function blank(): Promise<WriteResult> {
    return runWrite(() => device.displayBlank(target))
  }

  /* ---------------------------------------------------------------- events */

  function bindEvents(): () => void {
    return device.onEvent((evt) => {
      /* The panel is small enough that a re-read is cheaper than merging a
       * payload, and it is what keeps the UI honest when the revert chord or a
       * second client changed it. */
      const setEvents = target === 1 ? [KEEB_EV_PEER_DISPLAY_SET] : [KEEB_EV_DISPLAY_SET, KEEB_EV_TEXT_SET]
      const savedEvent = target === 1 ? KEEB_EV_PEER_DISPLAY_SAVED : KEEB_EV_DISPLAY_SAVED

      if (setEvents.includes(evt.event)) {
        void reload()
      } else if (evt.event === savedEvent) {
        unsavedWrites.value = false
        deviceDirty.value = false
        savedAt.value = new Date().toLocaleTimeString()
      }
    })
  }

  return {
    info, widgets, texts, values, preset, deviceDirty, loaded, loading, lastError, savedAt,
    canEdit, canDrawArt, logicalW, logicalH, widgetMax, textSlots, valueSlots, textMax, layerCount,
    hasLocalEdits, unsavedWrites, problems, statusLine,
    selectedWidget,
    load, reload, edit, addWidget, removeWidget, moveWidget, useTextSlot, dropLocalEdits,
    applyTable, setTextSlot, setValueSlot, save, discard, resetStorage, blank,
    validate, bindEvents,
  }
  })
}

/** The panel of the half holding this link. */
export const useDisplayStore = definePanelStore('display', 0)

/** The other half's panel: answered from the central's copy, relayed to it. */
export const usePeerDisplayStore = definePanelStore('displayPeer', 1)
