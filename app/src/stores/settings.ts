/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Firmware settings — the build values this keyboard lets a host change live.
 *
 * The model is the firmware's (keeb-module/settings/keeb_settings.c): the
 * compiled-in defaults are copied into RAM at boot, SETTINGS_SET rewrites RAM
 * (what ZMK compares against from its next tick), SETTINGS_SAVE is what
 * survives a reboot, SETTINGS_DISCARD puts the compiled-in values back and
 * deletes the saved copy. Apply and save are two operations here, exactly as
 * they are for the keymap and the panel.
 *
 * Only what the firmware exposes is a row: a build value with no KEEB_SETTINGS
 * flag cannot be written over the link, so it is not offered as editable.
 * Rows are the ms timeouts, the kscan debounce pair, the hold-tap timings
 * (central half only), two booleans (deep sleep, blank-on-idle) and the status
 * LED palette (brightness + the three colors).
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  KEEB_EV_SETTINGS_CHANGED,
  KEEB_INFO_F_SETTINGS,
  KEEB_SETTINGS_B_BLANK_ON_IDLE,
  KEEB_SETTINGS_B_SLEEP_ALLOWED,
  KEEB_SETTINGS_F_BLANK_ON_IDLE,
  KEEB_SETTINGS_F_DEBOUNCE_PRESS,
  KEEB_SETTINGS_F_DEBOUNCE_RELEASE,
  KEEB_SETTINGS_F_IDLE_TIMEOUT,
  KEEB_SETTINGS_F_LED_BRIGHTNESS,
  KEEB_SETTINGS_F_LED_COLOR_BLUE,
  KEEB_SETTINGS_F_LED_COLOR_GREEN,
  KEEB_SETTINGS_F_LED_COLOR_RED,
  KEEB_SETTINGS_F_LED_LAYERS,
  KEEB_SETTINGS_LED_LAYER_MAX,
  KEEB_SETTINGS_F_PRIOR_IDLE,
  KEEB_SETTINGS_F_QUICK_TAP,
  KEEB_SETTINGS_F_SLEEP_ALLOWED,
  KEEB_SETTINGS_F_SLEEP_TIMEOUT,
  KEEB_SETTINGS_F_TAPPING_TERM,
} from '../proto/constants.ts'
import type { SettingsPayload } from '../proto/types.ts'
import { LAYER_CAPACITY } from '../proto/zmk.gen.ts'
import { useDeviceStore } from './device.ts'
import { useKeymapStore } from './keymap.ts'

type WriteResult = { ok: boolean; reason?: string }

/** The numeric/color SettingsPayload properties a host can write. */
export type SettingPayloadKey = keyof Omit<
  SettingsPayload,
  'flags' | 'booleans' | 'holdTapFlavor'
>

export type FieldKind = 'ms' | 'percent' | 'bool' | 'color'

/** The groups the settings page shows the rows under, two columns at a time. */
export type SettingCategory = 'energy' | 'matrix' | 'holdTap' | 'led' | 'layerLed'

export const CATEGORY_LABEL: Record<SettingCategory, string> = {
  energy: 'energy',
  matrix: 'matrix scan',
  holdTap: 'hold-tap',
  led: 'status LED',
  layerLed: 'layer LED colors',
}

export const CATEGORY_ORDER: SettingCategory[] = ['energy', 'matrix', 'holdTap', 'led', 'layerLed']

export interface SettingField {
  /** staging key; for non-bool kinds equals the payload property it writes */
  key: string
  label: string
  /** The Kconfig / devicetree name, so the row can be matched to the build. */
  config: string
  note: string
  kind: FieldKind
  flag: number
  /** The category card the settings page shows this row under. */
  category: SettingCategory
  /** numeric kinds: acceptable range */
  min?: number
  max?: number
  /** kind 'bool': which bit of the booleans byte this drives */
  boolBit?: number
  /** non-bool kinds: the SettingsPayload property this reads from / writes to */
  payloadKey?: SettingPayloadKey
  /** set for an entry of an array payload: the position in that array */
  index?: number
}

const MS_MAX = 86_400_000 /* 24 h, inside the firmware's uint32_t */

export const SETTING_FIELDS: SettingField[] = [
  {
    key: 'idleTimeoutMs',
    payloadKey: 'idleTimeoutMs',
    label: 'idle timeout',
    config: 'CONFIG_ZMK_IDLE_TIMEOUT',
    note: 'no input for this long: the board goes idle (status screen blank, peripherals suspended). Relay mirrors it to both halves.',
    kind: 'ms',
    flag: KEEB_SETTINGS_F_IDLE_TIMEOUT,
    category: 'energy',
    min: 1000,
    max: MS_MAX,
  },
  {
    key: 'sleepTimeoutMs',
    payloadKey: 'sleepTimeoutMs',
    label: 'deep sleep timeout',
    config: 'CONFIG_ZMK_IDLE_SLEEP_TIMEOUT',
    note: 'no input for this long, not powered by USB: System OFF, waking costs a reconnect. Relay mirrors it to both halves.',
    kind: 'ms',
    flag: KEEB_SETTINGS_F_SLEEP_TIMEOUT,
    category: 'energy',
    min: 1000,
    max: MS_MAX,
  },
  {
    key: 'debouncePressMs',
    payloadKey: 'debouncePressMs',
    label: 'debounce press',
    config: 'kscan debounce-press-ms',
    note: 'matrix settling time on key-down. 0 is ZMK\u2019s eager setting. Relay mirrors it to both halves; each half scans its own matrix.',
    kind: 'ms',
    flag: KEEB_SETTINGS_F_DEBOUNCE_PRESS,
    category: 'matrix',
    min: 0,
    max: 100,
  },
  {
    key: 'debounceReleaseMs',
    payloadKey: 'debounceReleaseMs',
    label: 'debounce release',
    config: 'kscan debounce-release-ms',
    note: 'matrix settling time on key-up. Relay mirrors it to both halves.',
    kind: 'ms',
    flag: KEEB_SETTINGS_F_DEBOUNCE_RELEASE,
    category: 'matrix',
    min: 0,
    max: 100,
  },
  {
    key: 'tappingTermMs',
    payloadKey: 'tappingTermMs',
    label: 'hold-tap tapping term',
    config: 'hold-tap tapping-term-ms',
    note: 'how long a key is held before a hold resolves. Central half only, not relayed. 0 uses each binding\u2019s own value.',
    kind: 'ms',
    flag: KEEB_SETTINGS_F_TAPPING_TERM,
    category: 'holdTap',
    min: 1,
    max: 5000,
  },
  {
    key: 'quickTapMs',
    payloadKey: 'quickTapMs',
    label: 'hold-tap quick tap',
    config: 'hold-tap quick-tap-ms',
    note: 'window: a tapped key held again within this starts a repeat. 0 uses each binding\u2019s own value. Central half only.',
    kind: 'ms',
    flag: KEEB_SETTINGS_F_QUICK_TAP,
    category: 'holdTap',
    min: 1,
    max: 5000,
  },
  {
    key: 'priorIdleMs',
    payloadKey: 'priorIdleMs',
    label: 'hold-tap prior idle',
    config: 'hold-tap require-prior-idle-ms',
    note: 'rest period before a quick tap counts. 0 uses each binding\u2019s own value. Central half only.',
    kind: 'ms',
    flag: KEEB_SETTINGS_F_PRIOR_IDLE,
    category: 'holdTap',
    min: 0,
    max: 5000,
  },
  {
    key: 'sleepAllowed',
    label: 'deep sleep',
    config: 'CONFIG_ZMK_SLEEP',
    note: 'off \u2014 never reach System OFF, even on battery. The build can turn it off but a build with ZMK_SLEEP=n has no deep sleep at all. Relay mirrors it to both halves.',
    kind: 'bool',
    flag: KEEB_SETTINGS_F_SLEEP_ALLOWED,
    category: 'energy',
    boolBit: KEEB_SETTINGS_B_SLEEP_ALLOWED,
  },
  {
    key: 'blankOnIdle',
    label: 'blank screen on idle',
    config: 'CONFIG_ZMK_DISPLAY_BLANK_ON_IDLE',
    note: 'off \u2014 keep the status screen lit when idle instead of blanking it. Relay mirrors it to both halves.',
    kind: 'bool',
    flag: KEEB_SETTINGS_F_BLANK_ON_IDLE,
    category: 'energy',
    boolBit: KEEB_SETTINGS_B_BLANK_ON_IDLE,
  },
  {
    key: 'ledBrightnessPercent',
    payloadKey: 'ledBrightnessPercent',
    label: 'status LED brightness',
    config: 'CONFIG_ZMK_STATUS_LED_BRIGHTNESS_PERCENT',
    note: 'level every lit signal runs at, 0\u2013100; the palette dims as a whole. Relay mirrors it to both halves; each half drives its own LED.',
    kind: 'percent',
    flag: KEEB_SETTINGS_F_LED_BRIGHTNESS,
    category: 'led',
    min: 0,
    max: 100,
  },
  {
    key: 'ledColorRed',
    payloadKey: 'ledColorRed',
    label: 'status LED \u00b7 battery error color',
    config: 'status_led red channel',
    note: 'color used when the battery is low. Relay mirrors it to both halves.',
    kind: 'color',
    flag: KEEB_SETTINGS_F_LED_COLOR_RED,
    category: 'led',
  },
  {
    key: 'ledColorGreen',
    payloadKey: 'ledColorGreen',
    label: 'status LED \u00b7 connected color',
    config: 'status_led green channel',
    note: 'color of the profile-connected flash. Relay mirrors it to both halves.',
    kind: 'color',
    flag: KEEB_SETTINGS_F_LED_COLOR_GREEN,
    category: 'led',
  },
  {
    key: 'ledColorBlue',
    payloadKey: 'ledColorBlue',
    label: 'status LED \u00b7 advertising color',
    config: 'status_led blue channel',
    note: 'color of the advertising pulse. Relay mirrors it to both halves.',
    kind: 'color',
    flag: KEEB_SETTINGS_F_LED_COLOR_BLUE,
    category: 'led',
  },
  /*
   * One color per keyboard layer, pinned to the layer index: a layer that moves
   * in the keymap keeps its color. These are separate values from the status
   * palette above - changing a layer color leaves the BLE/status signals alone.
   * 0 means the LED is off while that layer is active (the home layer's default).
   *
   * The wire table is KEEB_SETTINGS_LED_LAYER_MAX entries and is written whole
   * (one flag), so the rows only go as far as this build's layer capacity.
   */
  ...Array.from({ length: LAYER_CAPACITY }, (_, i): SettingField => ({
    key: `ledLayerColor${i}`,
    payloadKey: 'ledLayerColors',
    index: i,
    label: `layer ${i} color`,
    config: 'status_led layer color',
    note: 'color this half shows while the layer is active; 0 = off. Pinned to the layer, and independent of the BLE colors above.',
    kind: 'color',
    flag: KEEB_SETTINGS_F_LED_LAYERS,
    category: 'layerLed',
  })),
]

/** 900000 -> "15 min", 30000 -> "30 s", 90000 -> "1 min 30 s". */
export function humanMs(ms: number): string {
  if (!Number.isFinite(ms)) {
    return '—'
  }

  const s = Math.round(ms / 1000)

  if (s < 60) {
    return `${s} s`
  }

  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60

  return [h ? `${h} h` : '', m ? `${m} min` : '', sec ? `${sec} s` : ''].filter(Boolean).join(' ')
}

/** 0xRRGGBB -> "#rrggbb" for a color input. */
export function colorToHex(n: number): string {
  return `#${((n & 0xffffff) | 0x1000000).toString(16).slice(1)}`
}

/** "#rrggbb" -> 0xRRGGBB, or null when it is not a three-byte hex color. */
export function hexToColor(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())

  return m ? parseInt(m[1], 16) : null
}

export const useSettingsStore = defineStore('settings', () => {
  const device = useDeviceStore()
  const keymap = useKeymapStore()

  /** What the keyboard last reported in its KEEB_T_SETTINGS record. */
  const remote = ref<SettingsPayload | null>(null)
  /** The working copy the rows edit (booleans staged as 0/1). */
  const staged = ref<Record<string, number>>({})

  const loaded = ref(false)
  const loading = ref(false)
  const lastError = ref('')
  /** When this session last had the keyboard persist the values. */
  const savedAt = ref('')

  const supported = computed(() => ((device.info?.flags ?? 0) & KEEB_INFO_F_SETTINGS) !== 0)
  const canWrite = computed(() => supported.value && device.writable)

  /** The value a field holds in a wire record: an array entry for the layer
   * colors, a plain property for everything else. */
  function remoteValue(r: SettingsPayload, field: SettingField): number | null {
    if (field.kind === 'bool') {
      return null
    }

    const v = field.payloadKey ? r[field.payloadKey] : null

    if (v === null || v === undefined) {
      return null
    }

    return Array.isArray(v) ? (v[field.index ?? 0] ?? 0) : v
  }

  const items = computed(() =>
    SETTING_FIELDS.map((field) => {
      const stagedV = staged.value[field.key]
      const value = field.kind === 'bool'
        ? stagedV === 1
        : (stagedV ?? 0)
      const fromDevice = field.kind === 'bool'
        ? ((remote.value?.booleans ?? 0) & (field.boolBit ?? 0)) !== 0
        : remote.value
          ? remoteValue(remote.value, field)
          : null

      return {
        /* A layer color row is named after the layer it belongs to, which is the
         * keymap's business, not this list's. */
        field: field.index === undefined
          ? field
          : { ...field, label: `layer ${keymap.layerName(field.index)} color` },
        value,
        fromDevice,
        changed: field.kind === 'bool'
          ? value !== fromDevice
          : fromDevice !== null && stagedV !== fromDevice,
        hint: hintFor(field, value),
        invalid: invalidFor(field, field.kind === 'bool' ? 0 : (stagedV ?? 0)),
      }
    }),
  )

  /** The rows grouped into the category cards the page renders, in order. */
  const groups = computed(() =>
    CATEGORY_ORDER.map((category) => ({
      category,
      label: CATEGORY_LABEL[category],
      items: items.value.filter((it) => it.field.category === category),
    })),
  )

  const problems = computed(() =>
    items.value
      .filter((it) => it.invalid)
      .map((it) => `${it.field.label}: ${invalidReason(it.field)}`),
  )

  const dirty = computed(() => items.value.some((it) => it.changed))

  const statusLine = computed(() => {
    if (!supported.value) {
      return 'this firmware build does not expose the settings channel'
    }

    if (!loaded.value) {
      return 'settings not read from the keyboard yet'
    }

    const state = dirty.value
      ? 'edited here, not applied'
      : savedAt.value
        ? `saved to flash at ${savedAt.value}`
        : 'live in the keyboard, not saved to flash'

    return `${items.value.length} settings` + ` \u00b7 ${state}`
  })

  function hintFor(field: SettingField, v: number | boolean): string {
    switch (field.kind) {
      case 'bool':
        return v ? 'on' : 'off'
      case 'percent':
        return `${Number(v)}%`
      case 'color':
        return colorToHex(Number(v))
      case 'ms':
        return humanMs(Number(v))
    }
  }

  function invalidFor(field: SettingField, v: number | boolean): boolean {
    if (field.kind === 'bool') {
      return false
    }

    const n = Number(v)

    if (field.kind === 'color') {
      return !Number.isInteger(n) || n < 0 || n > 0xffffff
    }

    return !Number.isFinite(n) || n < (field.min ?? 0) || n > (field.max ?? Infinity)
  }

  function invalidReason(field: SettingField): string {
    switch (field.kind) {
      case 'percent':
        return 'a whole percent between 0 and 100'
      case 'color':
        return 'a six-digit hex color'
      case 'ms':
      default:
        return `a whole number of ms between ${field.min} and ${field.max}`
    }
  }

  async function reload(): Promise<void> {
    if (!supported.value || device.state !== 'connected') {
      return
    }

    loading.value = true

    try {
      const got = await device.readSettings()

      remote.value = got
      staged.value = fromRemote(got)
      loaded.value = true
      lastError.value = ''
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  /** First read after a handshake: a keyboard without the namespace is stated,
   * not left as an error, because there is nothing for the user to fix. */
  async function load(): Promise<void> {
    if (!supported.value) {
      loaded.value = false
      lastError.value = 'this firmware build does not expose the settings channel'

      return
    }

    await reload()
  }

  /** The staged map (booleans 0/1) from a wire record. */
  function fromRemote(r: SettingsPayload): Record<string, number> {
    const m: Record<string, number> = {}

    for (const f of SETTING_FIELDS) {
      if (f.kind === 'bool') {
        m[f.key] = ((r.booleans ?? 0) & (f.boolBit ?? 0)) !== 0 ? 1 : 0
      } else {
        m[f.key] = remoteValue(r, f) ?? 0
      }
    }

    return m
  }

  /** What to send on apply, plus the flags of the fields a host is changing. */
  function stagedWrite(): Partial<SettingsPayload> & { flags: number } {
    let flags = 0
    let booleans = 0

    // The boolean byte always reflects both bool rows; writeSettingsSet masks out
    // whatever boolean a flag is not carrying.
    for (const f of SETTING_FIELDS) {
      if (f.kind === 'bool') {
        if (staged.value[f.key] === 1) {
          booleans |= f.boolBit ?? 0
        }
      }
    }

    const out: Partial<SettingsPayload> & { flags: number } = { flags, booleans }
    /* One flag writes the whole layer color table, so the array goes out as a
     * whole the moment any of its rows moved; the entries this build does not
     * show stay off. */
    let layersDirty = false

    for (const it of items.value) {
      if (!it.changed) {
        continue
      }
      flags |= it.field.flag

      if (it.field.kind === 'bool' || !it.field.payloadKey) {
        continue
      }

      if (it.field.index !== undefined) {
        layersDirty = true
        continue
      }

      ;(out as Record<string, number | number[]>)[it.field.payloadKey] = staged.value[it.field.key] ?? 0
    }

    if (layersDirty) {
      const colors = new Array<number>(KEEB_SETTINGS_LED_LAYER_MAX).fill(0)

      for (const f of SETTING_FIELDS) {
        if (f.index !== undefined) {
          colors[f.index] = staged.value[f.key] ?? 0
        }
      }

      out.ledLayerColors = colors
    }

    return { ...out, flags }
  }

  function set(key: string, raw: string | number): void {
    let n = typeof raw === 'number' ? raw : Number(raw)

    if (Number.isInteger(n)) {
      n = Math.trunc(n)
    }

    staged.value = { ...staged.value, [key]: n }
  }

  /** Throw the working copy away; the keyboard is untouched. */
  function dropLocalEdits(): void {
    if (remote.value) {
      staged.value = fromRemote(remote.value)
    }
  }

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

  /** SETTINGS_SET: the keyboard runs on these values from its next tick. */
  async function apply(): Promise<WriteResult> {
    const bad = problems.value[0]

    if (bad) {
      lastError.value = bad

      return { ok: false, reason: bad }
    }

    if (!dirty.value) {
      lastError.value = 'nothing staged to apply'

      return { ok: false, reason: lastError.value }
    }

    const wrote = await runWrite(() => device.writeSettings(stagedWrite()))

    if (wrote.ok) {
      savedAt.value = ''
      await reload()
    }

    return wrote
  }

  /** SETTINGS_SAVE: persist what the keyboard is already running on. */
  async function save(): Promise<WriteResult> {
    if (dirty.value) {
      lastError.value = 'apply the staged values before saving them'

      return { ok: false, reason: lastError.value }
    }

    const wrote = await runWrite(() => device.settingsSave())

    if (wrote.ok) {
      savedAt.value = new Date().toLocaleTimeString()
    }

    return wrote
  }

  /** SETTINGS_DISCARD: back to the compiled-in defaults, saved copy deleted. */
  async function discard(): Promise<WriteResult> {
    const wrote = await runWrite(() => device.settingsDiscard())

    if (wrote.ok) {
      savedAt.value = ''
      await reload()
    }

    return wrote
  }

  function bindEvents(): () => void {
    return device.onEvent((evt) => {
      /* The record holds every value and the keyboard is the only writer of it,
       * so a re-read beats merging the event's flag mask — and it also catches a
       * change made by a second client. */
      if (evt.event === KEEB_EV_SETTINGS_CHANGED) {
        savedAt.value = ''
        void reload()
      }
    })
  }

  return {
    remote, staged, loaded, loading, lastError, savedAt,
    supported, canWrite, items, groups, problems, dirty, statusLine,
    load, reload, set, dropLocalEdits, apply, save, discard, bindEvents,
  }
})