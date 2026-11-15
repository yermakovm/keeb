/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Simulated keyboard: a host-side stand-in for keeb-module's engine, built on
 * the same codec the firmware uses, so the configurator's live path (send a
 * message, get one ACK, react to notifications) is exercised without a
 * keyboard on the bench.
 *
 * It mirrors the engine's observable behaviour, not its internals:
 *   - one ACK per message, msg_id echoed, first failure reported (engine.c
 *     dispatch())
 *   - KEEB_ERR_BUSY while a reply is owed
 *   - CELLS_SET validated in full before any cell is written, reserved
 *     positions refused, KEEB_TOKEN_NONE refused on writes (keymap.c)
 *   - layer slots hold layer ids, a removed slot becomes 0xff, remove shifts
 *     left and restore shifts right (zmk/app/src/keymap.c)
 *   - notifications for layer state / cells set / saved / discarded / layer
 *     changed
 *   - the SETTINGS namespace: the two activity timeouts as RAM values, with
 *     SAVE (survives a reboot) and DISCARD (back to the compiled-in defaults)
 *     as separate operations
 *
 * What it does NOT model: ZMK's behavior metadata for real behaviors (the
 * param table below is the shape of KEEB_T_TOKEN_PARAMS, sized like the real
 * one), settings storage wear, and the split relay.
 */

import {
  BEHAVIOR_PARAMETER_VALUE_TYPE_HID_USAGE,
  BEHAVIOR_PARAMETER_VALUE_TYPE_LAYER_ID,
  BEHAVIOR_PARAMETER_VALUE_TYPE_RANGE,
  BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE,
  KEEB_BLE_FRAG_PAYLOAD,
  KEEB_CELL_F_RESERVED,
  KEEB_ERR_BAD_LEN,
  KEEB_ERR_BAD_WIDGET,
  KEEB_ERR_BEHAVIOR,
  KEEB_ERR_NO_SPACE,
  KEEB_ERR_NONE,
  KEEB_ERR_NOT_SUPPORTED,
  KEEB_ERR_OUT_OF_RANGE,
  KEEB_ERR_RESERVED_POSITION,
  KEEB_ERR_TOO_BIG,
  KEEB_ERR_UNKNOWN_TOKEN,
  KEEB_ERR_UNKNOWN_TYPE,
  KEEB_INFO_F_PERSISTENT,
  KEEB_INFO_F_DISPLAY,
  KEEB_INFO_F_REORDERING,
  KEEB_INFO_F_RESERVED_FROZEN,
  KEEB_INFO_F_SETTINGS,
  KEEB_PKT_F_NOTIFY,
  KEEB_PKT_F_REPLY,
  KEEB_STATUS_ERR,
  KEEB_STATUS_OK,
  KEEB_T_ACK,
  KEEB_T_CELLS,
  KEEB_T_CELLS_GET,
  KEEB_T_CELLS_SET,
  KEEB_T_DISPLAY,
  KEEB_T_DISPLAY_BLANK,
  KEEB_T_PEER_DISPLAY,
  KEEB_T_PEER_DISPLAY_BLANK,
  KEEB_T_PEER_DISPLAY_DISCARD,
  KEEB_T_PEER_DISPLAY_GET,
  KEEB_T_PEER_DISPLAY_INFO,
  KEEB_T_PEER_DISPLAY_RESET,
  KEEB_T_PEER_DISPLAY_SAVE,
  KEEB_T_PEER_DISPLAY_SET,
  KEEB_T_PEER_TEXT_SET,
  KEEB_T_DISPLAY_DISCARD,
  KEEB_T_DISPLAY_GET,
  KEEB_T_DISPLAY_INFO,
  KEEB_T_DISPLAY_RESET,
  KEEB_T_DISPLAY_SAVE,
  KEEB_T_DISPLAY_SET,
  KEEB_T_INFO,
  KEEB_T_LAYER_ADD,
  KEEB_T_LAYER_NAME_SET,
  KEEB_T_LAYER_MOVE,
  KEEB_T_LAYER_REMOVE,
  KEEB_T_LAYER_RESTORE,
  KEEB_T_LAYERS,
  KEEB_T_LAYERS_GET,
  KEEB_T_NOTIFY,
  KEEB_T_PING,
  KEEB_T_PRESET_NAME,
  KEEB_T_PRESET_SET,
  KEEB_T_RESET,
  KEEB_T_SAVE,
  KEEB_T_DISCARD,
  KEEB_T_SETTINGS,
  KEEB_T_SETTINGS_DISCARD,
  KEEB_T_SETTINGS_GET,
  KEEB_T_SETTINGS_RESET,
  KEEB_T_SETTINGS_SAVE,
  KEEB_T_SETTINGS_SET,
  KEEB_T_SOUND_MAP,
  KEEB_T_SOUND_MAP_SET,
  KEEB_T_TEXT_SET,
  KEEB_T_TUNE,
  KEEB_T_TUNE_GET,
  KEEB_T_TUNE_PLAY,
  KEEB_T_TUNE_SET,
  KEEB_T_VALUE_SET,
  KEEB_T_WIDGET_SET,
  KEEB_T_TOKEN_PARAMS,
  KEEB_T_TOKENS,
  KEEB_T_APPLY_COMMIT,
  KEEB_T_TEST_SET,
  KEEB_T_APPLY_CANCEL,
  KEEB_TOKEN_F_READY,
  KEEB_TOKEN_NAME_MAX,
  KEEB_TOKEN_NONE,
  KEEB_TOKEN_UNKNOWN,
  KEEB_TX_FAIL,
  KEEB_WID_ART,
  KEEB_WID_BAR,
  KEEB_WID_BONGO,
  KEEB_WID_BATTERY,
  KEEB_WID_COUNT,
  KEEB_WID_FRAME,
  KEEB_WID_PIPS,
  KEEB_WID_RULE,
  KEEB_WID_TEXT,
  KEEB_SRC_BATT_LEFT,
  KEEB_SRC_BATT_LEFT_PCT,
  KEEB_SRC_BATT_RIGHT,
  KEEB_SRC_BATT_RIGHT_PCT,
  KEEB_SRC_CHARGING,
  KEEB_SRC_DEVICE_ID,
  KEEB_SRC_LAYER_ART,
  KEEB_SRC_LAYER_INDEX,
  KEEB_SRC_LAYER_NAME,
  KEEB_SRC_LAYER_PIPS,
  KEEB_SRC_LAYER_POS,
  KEEB_SRC_LINK_SHORT,
  KEEB_SRC_NONE,
  KEEB_SRC_PROFILE_PIPS,
  KEEB_SRC_RSSI,
  KEEB_SRC_TEXT_BASE,
  KEEB_SRC_VALUE_BASE,
  KEEB_SRC_WPM,
  KEEB_PIPS_GEOMETRY,
  KEEB_PIPS_LARGE,
  KEEB_TEXT_STYLE,
  KEEB_PRESET_CUSTOM,
  KEEB_DISPLAY_INFO_F_ART,
  KEEB_DISPLAY_INFO_F_PEER,
  KEEB_DISPLAY_F_DIRTY,
  KEEB_EV_CELLS_SET,
  KEEB_EV_DISPLAY_SAVED,
  KEEB_EV_PEER_DISPLAY_SAVED,
  KEEB_EV_PEER_DISPLAY_SET,
  KEEB_EV_KEY,
  KEEB_EV_DISPLAY_SET,
  KEEB_EV_TEXT_SET,
  KEEB_EV_DISCARDED,
  KEEB_EV_LAYER_CHANGED,
  KEEB_EV_LAYER_STATE,
  KEEB_EV_SAVED,
  KEEB_EV_SETTINGS_CHANGED,
  KEEB_SETTINGS_B_ALL,
  KEEB_SETTINGS_B_BLANK_ON_IDLE,
  KEEB_SETTINGS_B_SLEEP_ALLOWED,
  KEEB_SETTINGS_F_ALL,
  KEEB_SETTINGS_F_BLANK_ON_IDLE,
  KEEB_SETTINGS_F_DEBOUNCE_PRESS,
  KEEB_SETTINGS_F_DEBOUNCE_RELEASE,
  KEEB_SETTINGS_F_HOLD_TAP_FLAVOR,
  KEEB_SETTINGS_F_IDLE_TIMEOUT,
  KEEB_SETTINGS_F_LED_BRIGHTNESS,
  KEEB_SETTINGS_F_LED_COLOR_BLUE,
  KEEB_SETTINGS_F_LED_COLOR_GREEN,
  KEEB_SETTINGS_F_LED_COLOR_RED,
  KEEB_SETTINGS_F_LED_LAYERS,
  KEEB_SETTINGS_F_PRIOR_IDLE,
  KEEB_SETTINGS_F_QUICK_TAP,
  KEEB_SETTINGS_F_SLEEP_ALLOWED,
  KEEB_SETTINGS_F_SLEEP_TIMEOUT,
  KEEB_SETTINGS_F_TAPPING_TERM,
  KEEB_SETTINGS_FLAVOR_AUTO,
  KEEB_SETTINGS_SIZE,
  KEEB_SOUND_EVENT_COUNT,
  KEEB_SOUND_MAP_SIZE,
  KEEB_SOUND_PLAY_SIZE,
  KEEB_SOUND_STEPS_MAX,
  KEEB_SOUND_TUNE_COUNT,
  KEEB_TUNE_HDR_SIZE,
  KEEB_TUNE_STEP_SIZE,
  KEEB_INFO_F_SOUND,
} from '../proto/constants.ts'
import { MessageReceiver, MessageSender, TlvMessage, iterateMessage, readSettings, tokenTableHash } from '../proto/tlv.ts'
import { EXPECTED_TOKEN_HASH, KEY_COUNT, LAYER_CAPACITY, RESERVED_POSITIONS, STOCK_LAYERS, STOCK_LAYER_NAMES, TOKENS } from '../proto/zmk.gen.ts'
import type { Binding, SettingsPayload, SoundPayload, TuneStep, Widget } from '../proto/types.ts'
import type { KeebTransport, TransportState } from './types.ts'

export const LAYER_ID_INVALID = 0xff
export const LAYER_NAME_MAX = 20 /* CONFIG_ZMK_KEYMAP_LAYER_NAME_MAX_LEN */

/** What the flashed image boots with: CONFIG_ZMK_IDLE_TIMEOUT (ZMK's default,
 * config/keeb.conf does not set it) and CONFIG_ZMK_IDLE_SLEEP_TIMEOUT
 * (keeb-module/boards/shields/keeb/keeb_left.conf / keeb_right.conf). */
const DEFAULT_IDLE_TIMEOUT_MS = 30000
const DEFAULT_SLEEP_TIMEOUT_MS = 900000

/** What a freshly-flashed keyboard boots with, mirroring keeb_settings.c's
 * compiled-in values: the two activity timeouts, the kscan debounce timings,
 * the hold-tap timings from keeb.keymap, and the status-LED palette. */
const DEFAULT_SETTINGS: SettingsPayload = {
  idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
  sleepTimeoutMs: DEFAULT_SLEEP_TIMEOUT_MS,
  debouncePressMs: 5,
  debounceReleaseMs: 5,
  tappingTermMs: 280,
  quickTapMs: 175,
  priorIdleMs: 150,
  ledBrightnessPercent: 50,
  ledColorRed: 0xff0000,
  ledColorGreen: 0x00ff00,
  ledColorBlue: 0x0000ff,
  /* home off, then the four non-home layers, pinned to the layer index */
  ledLayerColors: [0, 0x00ff00, 0x0000ff, 0x00ff00, 0x0000ff, 0, 0, 0],
  flags: KEEB_SETTINGS_F_ALL,
  booleans: KEEB_SETTINGS_B_SLEEP_ALLOWED | KEEB_SETTINGS_B_BLANK_ON_IDLE,
  holdTapFlavor: 1 /* balanced */,
}

/** The compiled-in tune shapes and event map, mirroring buzzer/src/buzzer.c.
 * Tune 0 (random) has no table; the other ids are enum zmk_buzzer_tune order and
 * event ids are enum zmk_buzzer_event order. */
const DEFAULT_TUNES: TuneStep[][] = [
  [],
  [{ pitchPct: 90, onMs: 45, gapMs: 30 }, { pitchPct: 115, onMs: 80, gapMs: 0 }],
  [{ pitchPct: 115, onMs: 45, gapMs: 30 }, { pitchPct: 90, onMs: 80, gapMs: 0 }],
  [{ pitchPct: 120, onMs: 60, gapMs: 20 }, { pitchPct: 100, onMs: 60, gapMs: 20 }, { pitchPct: 80, onMs: 120, gapMs: 0 }],
  [{ pitchPct: 105, onMs: 55, gapMs: 25 }, { pitchPct: 125, onMs: 110, gapMs: 0 }],
  [{ pitchPct: 80, onMs: 120, gapMs: 80 }, { pitchPct: 80, onMs: 160, gapMs: 0 }],
  [{ pitchPct: 95, onMs: 35, gapMs: 20 }, { pitchPct: 120, onMs: 55, gapMs: 0 }],
]

const DEFAULT_SOUND_MAP = [1, 2, 4, 5, 6] /* layer_on, layer_off, update_ok, update_fail, wake */

/** Tokens whose driver is not in this build. In firmware this is
 * zmk_behavior_get_binding() returning NULL; the UI must not offer them.
 * bl/rgb_ug are off in config/keeb.conf, so their nodes stay in devicetree
 * but no driver is compiled. */
const UNAVAILABLE_TOKENS = new Set(['bl', 'rgb_ug'])

/* --------------------------------------------------------------------------
 * Panel model
 *
 * Mirrors keeb-module/boards/shields/keeb/ui/widget_model.c for the central
 * half as the shipped build configures it (CONFIG_KEEB_UI_ROTATION_90, so the
 * logical space is 68x160 and the panel is rotated into 160x68). The preset
 * tables below are the firmware's, copied by hand: the mock stands in for the
 * engine's behaviour, it is not a second source of truth, and a drift between
 * them shows up as a preview that does not match the glass.
 * -------------------------------------------------------------------------- */

export const PANEL_LOGICAL_W = 68
export const PANEL_LOGICAL_H = 160
export const PANEL_PANEL_W = 160
export const PANEL_PANEL_H = 68
export const PANEL_ROTATION = 90
export const PANEL_WIDGET_MAX = 24
export const PANEL_TEXT_SLOTS = 8
export const PANEL_TEXT_MAX = 24
export const PANEL_VALUE_SLOTS = 4
export const PANEL_LAYER_COUNT = STOCK_LAYERS.length

const slot = (n: number): number => KEEB_SRC_TEXT_BASE + n

const wFrame = (x: number, y: number, w: number, h: number, radius: number): Widget =>
  ({ kind: KEEB_WID_FRAME, source: KEEB_SRC_NONE, x, y, w, h, style: radius })
const wRule = (x: number, y: number, w: number): Widget =>
  ({ kind: KEEB_WID_RULE, source: KEEB_SRC_NONE, x, y, w, h: 1, style: 0 })
const wText = (x: number, y: number, w: number, h: number, src: number, font: number, align: number): Widget =>
  ({ kind: KEEB_WID_TEXT, source: src, x, y, w, h, style: KEEB_TEXT_STYLE(font, align) })
const wBar = (x: number, y: number, w: number, h: number, src: number): Widget =>
  ({ kind: KEEB_WID_BAR, source: src, x, y, w, h, style: 0 })
const wPips = (x: number, y: number, pipW: number, pipH: number, geometry: number): Widget =>
  ({ kind: KEEB_WID_PIPS, source: KEEB_SRC_LAYER_PIPS, x, y, w: pipW, h: pipH, style: geometry })

export const PANEL_PRESETS: { name: string; widgets: Widget[]; texts: string[] }[] = [
  {
    name: 'STATUS',
    widgets: [
      wFrame(0, 0, 68, 160, 4),
      wText(5, 3, 34, 0, slot(0), 0, 0),
      wText(39, 3, 24, 0, KEEB_SRC_LINK_SHORT, 0, 2),
      wRule(4, 13, 60),
      wFrame(15, 17, 38, 32, 3),
      wText(15, 17, 38, 32, KEEB_SRC_LAYER_INDEX, 2, 1),
      wText(4, 53, 60, 0, KEEB_SRC_LAYER_NAME, 1, 1),
      wText(4, 70, 60, 0, KEEB_SRC_LAYER_POS, 0, 1),
      wPips(5, 82, 7, 4, KEEB_PIPS_LARGE),
      wText(7, 94, 16, 0, slot(1), 0, 0),
      wText(25, 94, 28, 0, KEEB_SRC_BATT_LEFT_PCT, 0, 2),
      wBar(7, 105, 46, 4, KEEB_SRC_BATT_LEFT),
      wText(7, 114, 16, 0, slot(2), 0, 0),
      wText(25, 114, 28, 0, KEEB_SRC_BATT_RIGHT_PCT, 0, 2),
      wBar(7, 125, 46, 4, KEEB_SRC_BATT_RIGHT),
      wRule(4, 138, 60),
      wText(4, 142, 60, 0, KEEB_SRC_CHARGING, 0, 1),
      wText(4, 151, 60, 0, slot(3), 0, 1),
    ],
    texts: ['KEYBOARD SYSTEM', 'LEFT', 'RIGHT', 'SYS. READY_'],
  },
  {
    name: 'MINIMAL',
    widgets: [
      wFrame(0, 0, 68, 160, 4),
      wFrame(6, 6, 56, 40, 3),
      wText(6, 6, 56, 40, KEEB_SRC_LAYER_INDEX, 2, 1),
      wText(4, 52, 60, 0, KEEB_SRC_LAYER_NAME, 1, 1),
      wText(4, 104, 60, 0, slot(0), 0, 1),
      wText(4, 116, 60, 40, KEEB_SRC_DEVICE_ID, 2, 1),
    ],
    texts: ['DEVICE'],
  },
]

/** Preset 2 on the peripheral: CONFIG_KEEB_UI_PEER_PRESET / the TYPING table in
 * widget_model.c. The mock stands in for the *central*, so this is the table it
 * seeds its copy of the other half with. */
export const PEER_TYPING: Widget[] = [
  wFrame(0, 0, 68, 160, 4),
  { kind: KEEB_WID_BONGO, source: KEEB_SRC_NONE, x: 0, y: 8, w: 68, h: 40, style: 0 },
  wRule(4, 54, 60),
  wText(4, 58, 60, 0, slot(0), 0, 1),
  wText(4, 70, 60, 30, KEEB_SRC_WPM, 2, 1),
  wRule(4, 106, 60),
  wPips(4, 112, 7, 5, KEEB_PIPS_LARGE),
  wBar(10, 122, 48, 6, KEEB_SRC_RSSI),
  wText(4, 136, 60, 0, KEEB_SRC_DEVICE_ID, 0, 1),
]

const PEER_TEXTS = ['WPM']

interface PanelState {
  widgets: Widget[]
  preset: number
  texts: string[]
  values: number[]
  dirty: boolean
  /** what DISPLAY_DISCARD returns to, i.e. the last DISPLAY_SAVE */
  saved: { widgets: Widget[]; preset: number; texts: string[] } | null
}

const peerPanelState = (): PanelState => ({
  widgets: PEER_TYPING.map((w) => ({ ...w })),
  preset: 2,
  texts: Array.from({ length: PANEL_TEXT_SLOTS }, (_, i) => PEER_TEXTS[i] ?? ''),
  values: Array.from({ length: PANEL_VALUE_SLOTS }, () => 0),
  dirty: false,
  saved: null,
})

const panelFromPreset = (id: number): PanelState => {
  const p = PANEL_PRESETS[id] ?? PANEL_PRESETS[0]

  return {
    widgets: p.widgets.map((w) => ({ ...w })),
    preset: p === PANEL_PRESETS[0] ? 0 : PANEL_PRESETS.indexOf(p),
    texts: Array.from({ length: PANEL_TEXT_SLOTS }, (_, i) => p.texts[i] ?? ''),
    values: Array.from({ length: PANEL_VALUE_SLOTS }, () => 0),
    dirty: false,
    saved: null,
  }
}

/** A source the firmware can actually resolve (keeb_ui_validate_widget). */
const sourceKnown = (src: number): boolean => {
  if (src >= KEEB_SRC_NONE && src <= KEEB_SRC_RSSI) {
    return true
  }

  if (src >= KEEB_SRC_TEXT_BASE && src < KEEB_SRC_TEXT_BASE + PANEL_TEXT_SLOTS) {
    return true
  }

  return src >= KEEB_SRC_VALUE_BASE && src < KEEB_SRC_VALUE_BASE + PANEL_VALUE_SLOTS
}

/** A kind only accepts the sources that can feed it. */
const kindSourceOk = (w: Widget): boolean => {
  switch (w.kind) {
    case KEEB_WID_TEXT:
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
        (w.source >= KEEB_SRC_VALUE_BASE && w.source < KEEB_SRC_VALUE_BASE + PANEL_VALUE_SLOTS)
      )
    case KEEB_WID_PIPS:
      return w.source === KEEB_SRC_LAYER_PIPS || w.source === KEEB_SRC_PROFILE_PIPS
    case KEEB_WID_ART:
      return w.source === KEEB_SRC_LAYER_ART
    default:
      return w.source === KEEB_SRC_NONE
  }
}

/** 0, or a KEEB_ERR_* the mock reports the way keeb_ui_validate_widget does. */
export const validateWidget = (w: Widget): number => {
  if (w.kind >= KEEB_WID_COUNT) {
    return KEEB_ERR_BAD_WIDGET
  }

  if (!sourceKnown(w.source) || !kindSourceOk(w)) {
    return KEEB_ERR_BAD_WIDGET
  }

  if (w.x >= PANEL_LOGICAL_W || w.y >= PANEL_LOGICAL_H) {
    return KEEB_ERR_OUT_OF_RANGE
  }

  if (w.x + w.w > PANEL_LOGICAL_W || w.y + w.h > PANEL_LOGICAL_H) {
    return KEEB_ERR_OUT_OF_RANGE
  }

  if (w.kind === KEEB_WID_PIPS) {
    const gap = KEEB_PIPS_GEOMETRY[w.style]?.gap ?? 2

    if (w.x + PANEL_LAYER_COUNT * (w.w + gap) > PANEL_LOGICAL_W) {
      return KEEB_ERR_OUT_OF_RANGE
    }
  }

  return 0
}

interface MockCell extends Binding {
  pos: number
}

export class MockKeyboard implements KeebTransport {
  readonly label = 'mock keyboard'
  /** Mirrors the BLE transport: the ATT PDU must hold the whole KEEB packet. */
  readonly maxFragment = KEEB_BLE_FRAG_PAYLOAD
  state: TransportState = 'offline'

  /** slot index -> layer id (0xff when the slot is empty) */
  private order: number[] = STOCK_LAYER_NAMES.map((_, i) => i)
  private names = new Map<number, string>()
  private cells = new Map<number, MockCell[]>()
  /** the layout as saved to settings, i.e. what DISCARD returns to */
  private persisted: { order: number[]; names: Map<number, string>; cells: Map<number, MockCell[]> } | null = null

  private layerState = 0x01 /* HOME active at boot */
  private panel: PanelState = panelFromPreset(0)
  /** The central's copy of the other half's panel (KEEB_T_PEER_*). */
  private peerPanel: PanelState = peerPanelState()

  /** The runtime settings, as keeb_settings.c holds them in RAM. */
  private settings: SettingsPayload = { ...DEFAULT_SETTINGS }
  /** Whether SETTINGS_SAVE has been accepted since the last DISCARD. */
  private settingsSaved = false
  private tunes: TuneStep[][] = DEFAULT_TUNES.map((t) => t.map((s) => ({ ...s })))
  private soundMap: number[] = [...DEFAULT_SOUND_MAP]
  private tunePlays: number[] = []
  private locked = 0
  private notifySeq = 0

  /* Tester mode, mirrored from the firmware: key events are only reported while
   * a host has asked for them. */
  private testMode = false
  private nextMsgId = 1

  private packetHandlers = new Set<(pkt: Uint8Array) => void>()
  private stateHandlers = new Set<(s: TransportState, detail: string) => void>()
  private sender: MessageSender

  constructor() {
    for (let id = 0; id < LAYER_CAPACITY; id++) {
      this.names.set(id, STOCK_LAYER_NAMES[id] ?? `L${id}`)
      this.cells.set(id, STOCK_LAYERS[id]?.cells.map((c, pos) => ({ pos, ...c })) ?? [])
    }

    this.sender = new MessageSender(this.deliver, this.maxFragment)
  }

  async connect(): Promise<void> {
    this.setState('connecting', 'simulated keyboard')
    /* Yield like a real link does, so the UI's connecting state is real. */
    await new Promise((r) => setTimeout(r, 50))
    this.setState('connected', this.label)
  }

  disconnect(): void {
    this.testMode = false
    this.setState('offline', 'disconnected')
  }

  send = (pkt: Uint8Array): number => {
    /* Host -> keyboard: this is the cmd characteristic write handler. */
    if (this.state !== 'connected') {
      return KEEB_TX_FAIL
    }

    queueMicrotask(() => this.receiveFromHost(pkt))

    return 0
  }

  onPacket(handler: (pkt: Uint8Array) => void): () => void {
    this.packetHandlers.add(handler)

    return () => this.packetHandlers.delete(handler)
  }

  onState(handler: (state: TransportState, detail: string) => void): () => void {
    this.stateHandlers.add(handler)

    return () => this.stateHandlers.delete(handler)
  }

  /* ------------------------------------------------------------------ dev hooks */

  /** Stand-in for someone pressing a MO/TO key on the real keyboard: the
   * layer-state event the configurator has to follow. */
  simulateLayerState(mask: number): void {
    this.layerState = mask
    this.notify(KEEB_EV_LAYER_STATE, u32(mask))
  }

  /** Stand-in for the revert chord (hold every reserved position). */
  simulateRevertChord(): void {
    this.discard()
    this.notify(KEEB_EV_DISCARDED, new Uint8Array())
  }

  get savedToSettings(): boolean {
    return this.persisted !== null
  }

  /* ------------------------------------------------------------------ plumbing */

  private setState(state: TransportState, detail = ''): void {
    this.state = state

    for (const h of this.stateHandlers) {
      h(state, detail)
    }
  }

  private deliver = (pkt: Uint8Array): number => {
    for (const h of this.packetHandlers) {
      h(pkt)
    }

    return 0
  }

  private notify(event: number, data: Uint8Array): void {
    const msg = new TlvMessage()
    const dv = msg.add(KEEB_T_NOTIFY, 4 + data.length)

    if (!dv) {
      return
    }

    dv.setUint16(0, event, true)
    dv.setUint16(2, this.notifySeq++, true)
    msg.buf.set(data, msg.len - data.length)

    const sender = new MessageSender(this.deliver, this.maxFragment)

    sender.sendAll(msg.bytes(), this.nextMsgId++, KEEB_PKT_F_REPLY | KEEB_PKT_F_NOTIFY)
  }

  /** Tester mode's switch. A simulated keyboard has no fingers, so the tester
   * view presses it directly — and the event then travels the same notification
   * path the firmware uses, so nothing downstream can tell the difference. */
  simulateKey(pos: number, pressed: boolean, layer = 0): void {
    if (!this.testMode) {
      return
    }

    this.notify(KEEB_EV_KEY, new Uint8Array([pos & 0xff, pressed ? 1 : 0, layer & 0xff]))
  }

  /** Whether this keyboard is currently reporting its switches. */
  get testModeOn(): boolean {
    return this.testMode
  }

  /* ------------------------------------------------------------------ dispatch */
  private receiveFromHost(pkt: Uint8Array): void {
    /* Reassembly is the host's job in reverse: the mock runs the same
     * fragment rules on the way in, so a half-sent message fails here exactly
     * as it would on the keyboard. */
    const reassembled = this.rx.feed(pkt)

    if (reassembled.kind === 'error') {
      this.sendAck(reassembled.msgId, KEEB_STATUS_ERR, reassembled.err)
      return
    }

    if (reassembled.kind !== 'complete') {
      return
    }

    this.dispatch(reassembled.msgId, reassembled.msg)
  }

  private rx = new MessageReceiver()

  private dispatch(msgId: number, msgBytes: Uint8Array): void {
    const reply = new TlvMessage()
    const ackDv = reply.add(KEEB_T_ACK, 10)

    if (!ackDv) {
      return
    }

    ackDv.setUint16(0, msgId, true)
    ackDv.setUint8(2, KEEB_STATUS_OK)
    ackDv.setUint8(3, KEEB_ERR_NONE)
    ackDv.setUint16(4, 0, true)
    ackDv.setUint32(6, 0, true)

    let detail = 0
    let extra = 0
    let status = KEEB_STATUS_OK
    let err = KEEB_ERR_NONE

    const fail = (code: number) => {
      if (status === KEEB_STATUS_OK) {
        status = KEEB_STATUS_ERR
        err = code
      }
    }

    const { records } = iterateMessage(msgBytes)

    for (const rec of records) {
      switch (rec.type) {
        case KEEB_T_PING:
          break

        case KEEB_T_INFO:
          this.writeInfo(reply)
          break

        case KEEB_T_TOKENS:
          this.writeTokens(reply, rec.value, fail)
          break

        case KEEB_T_TOKEN_PARAMS:
          this.writeTokenParams(reply, rec.value, fail)
          break

        case KEEB_T_CELLS_GET:
          this.writeCells(reply, rec.value, fail)
          break

        case KEEB_T_CELLS_SET: {
          const applied = this.applyCells(rec.value, fail)

          if (status === KEEB_STATUS_OK) {
            detail = applied
            this.notify(KEEB_EV_CELLS_SET, new Uint8Array([rec.value[0], applied & 0xff, (applied >> 8) & 0xff]))
          }
          break
        }

        case KEEB_T_LAYERS_GET:
          this.writeLayers(reply)
          break

        case KEEB_T_LAYER_NAME_SET:
          this.setLayerName(rec.value, fail)
          break

        case KEEB_T_LAYER_MOVE:
          this.moveLayer(rec.value, fail)
          break

        case KEEB_T_LAYER_ADD: {
          const idx = this.addLayer()

          if (idx < 0) {
            fail(KEEB_ERR_NO_SPACE)
          } else {
            detail = idx
            this.notify(KEEB_EV_LAYER_CHANGED, new Uint8Array())
          }
          break
        }

        case KEEB_T_LAYER_REMOVE:
          this.removeLayer(rec.value[0], fail)
          break

        case KEEB_T_LAYER_RESTORE:
          this.restoreLayer(rec.value[0], rec.value[1], fail)
          break

        case KEEB_T_SAVE:
          this.save()
          break

        case KEEB_T_DISCARD:
          this.discard()
          break

        case KEEB_T_RESET:
          this.reset()
          break

        case KEEB_T_DISPLAY_INFO:
          this.writeDisplayInfo(reply)
          break

        case KEEB_T_DISPLAY_GET:
          this.writeDisplay(reply)
          break

        case KEEB_T_DISPLAY_SET: {
          const applied = this.applyDisplaySet(rec.value, fail)

          if (status === KEEB_STATUS_OK) {
            detail = applied
            this.notify(KEEB_EV_DISPLAY_SET, new Uint8Array([applied & 0xff, KEEB_DISPLAY_F_DIRTY]))
          }
          break
        }

        /* The engine ACKs these with detail 0 — the host reads the result back
         * with DISPLAY_GET, which is also what the app does after a write. */
        case KEEB_T_WIDGET_SET:
          this.applyWidgetSet(rec.value, fail)
          break

        case KEEB_T_TEXT_SET: {
          const slot = this.applyTextSlot(rec.value, fail)

          if (status === KEEB_STATUS_OK) {
            this.notify(KEEB_EV_TEXT_SET, new Uint8Array([slot]))
          }
          break
        }

        case KEEB_T_VALUE_SET:
          this.applyValueSlot(rec.value, fail)
          break

        case KEEB_T_PRESET_SET:
          this.applyPanelPreset(rec.value, fail)
          break

        case KEEB_T_DISPLAY_SAVE:
          this.savePanel()
          this.notify(KEEB_EV_DISPLAY_SAVED, new Uint8Array())
          break

        case KEEB_T_DISPLAY_DISCARD:
          this.discardPanel()
          break

        case KEEB_T_DISPLAY_RESET:
          this.resetPanel()
          break

        case KEEB_T_DISPLAY_BLANK:
          break

        /* The other half's panel: the same records with a PEER prefix, answered
         * from the central's copy (keeb-module/display/keeb_peer_panel.c). */
        case KEEB_T_PEER_DISPLAY_INFO:
          this.writeDisplayInfo(reply, true)
          break

        case KEEB_T_PEER_DISPLAY_GET:
          this.writeDisplay(reply, true)
          break

        case KEEB_T_PEER_DISPLAY_SET: {
          const applied = this.applyDisplaySet(rec.value, fail, true)

          if (status === KEEB_STATUS_OK) {
            detail = applied
            this.notify(KEEB_EV_PEER_DISPLAY_SET, new Uint8Array([applied & 0xff, KEEB_DISPLAY_F_DIRTY]))
          }
          break
        }

        case KEEB_T_PEER_TEXT_SET: {
          this.applyTextSlot(rec.value, fail, true)

          if (status === KEEB_STATUS_OK) {
            this.notify(KEEB_EV_PEER_DISPLAY_SET, new Uint8Array([this.peerPanel.widgets.length & 0xff, KEEB_DISPLAY_F_DIRTY]))
          }
          break
        }

        case KEEB_T_PEER_DISPLAY_SAVE:
          this.savePanel(true)
          this.notify(KEEB_EV_PEER_DISPLAY_SAVED, new Uint8Array())
          break

        case KEEB_T_PEER_DISPLAY_DISCARD:
          this.discardPanel(true)
          break

        case KEEB_T_PEER_DISPLAY_RESET:
          this.resetPanel(true)
          break

        case KEEB_T_PEER_DISPLAY_BLANK:
          break

        case KEEB_T_SETTINGS_GET:
          this.writeSettings(reply)
          break

        case KEEB_T_SETTINGS_SET:
          this.applySettings(rec.value, fail)
          break

        case KEEB_T_SETTINGS_SAVE:
          /* One flash verb for both subtrees, exactly as the engine wires it. */
          this.settingsSaved = true
          break

        /* keeb_settings_discard() goes back to the compiled-in defaults and
         * deletes the saved subtree — it does not restore a saved snapshot. */
        case KEEB_T_SETTINGS_DISCARD:
        case KEEB_T_SETTINGS_RESET:
          this.discardSettings()
          break

        case KEEB_T_TUNE_GET:
          this.writeSound(reply)
          break

        case KEEB_T_TUNE_SET:
          this.applyTune(rec.value, fail)
          break

        case KEEB_T_SOUND_MAP_SET:
          this.applySoundMap(rec.value, fail)
          break

        /* Preview: a sound and nothing else, so the page can stay clean. */
        case KEEB_T_TUNE_PLAY:
          this.playTune(rec.value)
          break

        case KEEB_T_TEST_SET: {
          this.testMode = (rec.value[0] ?? 0) !== 0
          detail = this.testMode ? 1 : 0
          break
        }

        case KEEB_T_APPLY_COMMIT:
        case KEEB_T_APPLY_CANCEL:
          fail(KEEB_ERR_NOT_SUPPORTED)
          break

        default:
          fail(KEEB_ERR_UNKNOWN_TYPE)
      }
    }

    const ack = new DataView(reply.buf.buffer, reply.buf.byteOffset, reply.buf.byteLength)

    ack.setUint8(4 + 2, status)
    ack.setUint8(4 + 3, err)
    ack.setUint16(4 + 4, detail, true)
    ack.setUint32(4 + 6, extra, true)

    this.sender.sendAll(reply.bytes(), msgId, KEEB_PKT_F_REPLY)
  }

  /* ------------------------------------------------------------------ handlers */

  private writeInfo(msg: TlvMessage): void {
    const dv = msg.add(KEEB_T_INFO, 20)

    if (!dv) {
      return
    }

    dv.setUint16(0, 1, true) /* proto */
    dv.setUint16(2, 1, true) /* fw_version: CONFIG_KEEB_ENGINE_FW_VERSION */
    dv.setUint16(4, LAYER_CAPACITY, true)
    dv.setUint16(6, KEY_COUNT, true)
    dv.setUint16(8, LAYER_NAME_MAX, true)
    dv.setUint16(10, TOKENS.length, true)
    dv.setUint32(12, tokenTableHash(TOKENS), true)
    dv.setUint32(
      16,
      KEEB_INFO_F_RESERVED_FROZEN | KEEB_INFO_F_PERSISTENT | KEEB_INFO_F_REORDERING |
        KEEB_INFO_F_DISPLAY | KEEB_INFO_F_SETTINGS | KEEB_INFO_F_SOUND,
      true,
    )
  }

  /* ---------------------------------------------------------------- display */

  private writeDisplayInfo(msg: TlvMessage, peer = false): void {
    /* struct keeb_display_info is 21 bytes. */
    const dv = msg.add(peer ? KEEB_T_PEER_DISPLAY_INFO : KEEB_T_DISPLAY_INFO, 21)

    if (!dv) {
      return
    }

    dv.setUint8(0, 1) /* editable: the central owns both tables */
    dv.setUint8(1, peer ? 3 : PANEL_PRESETS.length)
    dv.setUint8(2, PANEL_WIDGET_MAX)
    dv.setUint8(3, PANEL_TEXT_SLOTS)
    dv.setUint8(4, PANEL_TEXT_MAX)
    /* The peer's value slots are not relayed, exactly as keeb_peer_panel_info
     * reports: the editor hides them instead of offering a control that cannot
     * reach the other half. */
    dv.setUint8(5, peer ? 0 : PANEL_VALUE_SLOTS)
    dv.setUint8(6, KEEB_WID_COUNT)
    dv.setUint8(7, peer ? KEEB_SRC_RSSI : KEEB_SRC_VALUE_BASE + PANEL_VALUE_SLOTS - 1)
    dv.setUint16(8, PANEL_LOGICAL_W, true)
    dv.setUint16(10, PANEL_LOGICAL_H, true)
    dv.setUint16(12, PANEL_PANEL_W, true)
    dv.setUint16(14, PANEL_PANEL_H, true)
    dv.setUint16(16, PANEL_ROTATION, true)
    dv.setUint8(18, 7) /* sizeof(struct keeb_widget) */
    dv.setUint8(19, KEEB_DISPLAY_INFO_F_ART | (peer ? 0 : KEEB_DISPLAY_INFO_F_PEER))
    dv.setUint8(20, PANEL_LAYER_COUNT)

    if (peer) {
      return /* the peer's preset names are not part of the record set */
    }

    for (let id = 0; id < PANEL_PRESETS.length; id++) {
      const name = PANEL_PRESETS[id].name
      const rec = msg.add(KEEB_T_PRESET_NAME, 2 + name.length)

      if (!rec) {
        return
      }

      rec.setUint8(0, id)
      rec.setUint8(1, name.length)
      msg.buf.set(new TextEncoder().encode(name), msg.len - name.length)
    }
  }

  /** One KEEB_T_DISPLAY record, then the slots as their own records: the same
   * shape keeb_display_dump() builds. */
  private writeDisplay(msg: TlvMessage, peer = false): void {
    const panel = peer ? this.peerPanel : this.panel
    const widgets = panel.widgets
    const dv = msg.add(peer ? KEEB_T_PEER_DISPLAY : KEEB_T_DISPLAY, 4 + widgets.length * 7)

    if (!dv) {
      return
    }

    dv.setUint8(0, widgets.length)
    dv.setUint8(1, panel.preset)
    dv.setUint8(2, panel.dirty ? KEEB_DISPLAY_F_DIRTY : 0)
    dv.setUint8(3, peer ? 1 : 0)

    for (let i = 0; i < widgets.length; i++) {
      const at = 4 + i * 7

      dv.setUint8(at, widgets[i].kind)
      dv.setUint8(at + 1, widgets[i].source)
      dv.setUint8(at + 2, widgets[i].x)
      dv.setUint8(at + 3, widgets[i].y)
      dv.setUint8(at + 4, widgets[i].w)
      dv.setUint8(at + 5, widgets[i].h)
      dv.setUint8(at + 6, widgets[i].style)
    }

    for (let s = 0; s < PANEL_TEXT_SLOTS; s++) {
      const text = panel.texts[s] ?? ''
      const enc = new TextEncoder().encode(text)
      const rec = msg.add(peer ? KEEB_T_PEER_TEXT_SET : KEEB_T_TEXT_SET, 2 + enc.length)

      if (!rec) {
        return
      }

      rec.setUint8(0, s)
      rec.setUint8(1, enc.length)
      msg.buf.set(enc, msg.len - enc.length)
    }

    if (peer) {
      return /* no live value slots cross the split link */
    }

    for (let s = 0; s < PANEL_VALUE_SLOTS; s++) {
      const rec = msg.add(KEEB_T_VALUE_SET, 4)

      if (!rec) {
        return
      }

      rec.setUint8(0, s)
      rec.setUint8(1, 0)
      rec.setInt16(2, this.panel.values[s] ?? 0, true)
    }
  }

  /** Validate the whole table before replacing any of it. */
  private applyDisplaySet(value: Uint8Array, fail: (c: number) => void, peer = false): number {
    if (value.length < 4) {
      fail(KEEB_ERR_BAD_LEN)
      return 0
    }

    const count = value[0]

    if (count > PANEL_WIDGET_MAX) {
      fail(KEEB_ERR_NO_SPACE)
      return 0
    }

    if (value.length !== 4 + count * 7) {
      fail(KEEB_ERR_BAD_LEN)
      return 0
    }

    const next: Widget[] = []

    for (let i = 0; i < count; i++) {
      const at = 4 + i * 7
      const w: Widget = {
        kind: value[at],
        source: value[at + 1],
        x: value[at + 2],
        y: value[at + 3],
        w: value[at + 4],
        h: value[at + 5],
        style: value[at + 6],
      }
      const err = validateWidget(w)

      if (err) {
        fail(err)
        return 0
      }

      next.push(w)
    }

    const panel = peer ? this.peerPanel : this.panel

    panel.widgets = next
    panel.preset = KEEB_PRESET_CUSTOM
    panel.dirty = true

    return count
  }

  /** The index the widget ended up at, or -1 when the write was refused. */
  private applyWidgetSet(value: Uint8Array, fail: (c: number) => void): number {
    if (value.length < 2 + 7) {
      fail(KEEB_ERR_BAD_LEN)
      return -1
    }

    const index = value[0]
    const count = this.panel.widgets.length

    if (index > count) {
      fail(KEEB_ERR_OUT_OF_RANGE)
      return -1
    }

    const at = 2
    const w: Widget = {
      kind: value[at],
      source: value[at + 1],
      x: value[at + 2],
      y: value[at + 3],
      w: value[at + 4],
      h: value[at + 5],
      style: value[at + 6],
    }
    const err = validateWidget(w)

    if (err) {
      fail(err)
      return -1
    }

    const next = this.panel.widgets.map((it) => ({ ...it }))

    if (index === count) {
      next.push(w)
    } else {
      next[index] = w
    }

    this.panel.widgets = next
    this.panel.preset = KEEB_PRESET_CUSTOM
    this.panel.dirty = true

    return index
  }

  private applyTextSlot(value: Uint8Array, fail: (c: number) => void, peer = false): number {
    if (value.length < 2) {
      fail(KEEB_ERR_BAD_LEN)
      return -1
    }

    const slotId = value[0]
    const len = value[1]

    if (len !== value.length - 2) {
      fail(KEEB_ERR_BAD_LEN)
      return -1
    }

    if (slotId >= PANEL_TEXT_SLOTS) {
      fail(KEEB_ERR_OUT_OF_RANGE)
      return -1
    }

    if (len > PANEL_TEXT_MAX) {
      fail(KEEB_ERR_TOO_BIG)
      return -1
    }

    const panel = peer ? this.peerPanel : this.panel

    panel.texts[slotId] = new TextDecoder().decode(value.subarray(2, 2 + len))
    panel.dirty = true

    return slotId
  }

  private applyValueSlot(value: Uint8Array, fail: (c: number) => void): number {
    if (value.length < 4) {
      fail(KEEB_ERR_BAD_LEN)
      return -1
    }

    const slotId = value[0]

    if (slotId >= PANEL_VALUE_SLOTS) {
      fail(KEEB_ERR_OUT_OF_RANGE)
      return -1
    }

    /* Live only, like the firmware: a value slot is never part of what SAVE
     * writes, so it never marks the panel dirty. */
    this.panel.values[slotId] = new DataView(value.buffer, value.byteOffset, value.byteLength).getInt16(2, true)

    return slotId
  }

  private applyPanelPreset(value: Uint8Array, fail: (c: number) => void): number {
    const id = value.length >= 2 ? value[0] : 0

    if (id >= PANEL_PRESETS.length) {
      fail(KEEB_ERR_OUT_OF_RANGE)
      return -1
    }

    this.panel = { ...panelFromPreset(id), saved: this.panel.saved }
    this.panel.dirty = true

    return id
  }

  private savePanel(peer = false): void {
    const panel = peer ? this.peerPanel : this.panel

    panel.saved = {
      widgets: panel.widgets.map((w) => ({ ...w })),
      preset: panel.preset,
      texts: [...panel.texts],
    }
    panel.dirty = false
  }

  private discardPanel(peer = false): void {
    const panel = peer ? this.peerPanel : this.panel

    if (panel.saved) {
      panel.widgets = panel.saved.widgets.map((w) => ({ ...w }))
      panel.preset = panel.saved.preset
      panel.texts = [...panel.saved.texts]
    } else if (peer) {
      this.peerPanel = peerPanelState()
    } else {
      this.panel = { ...panelFromPreset(0), saved: null }
    }

    const current = peer ? this.peerPanel : this.panel

    current.dirty = false
  }

  private resetPanel(peer = false): void {
    if (peer) {
      this.peerPanel = peerPanelState()
      return
    }

    this.panel = panelFromPreset(0)
  }

  private writeTokens(msg: TlvMessage, value: Uint8Array, fail: (c: number) => void): void {
    const start = value.length >= 2 ? value[0] | (value[1] << 8) : 0
    const hdr = msg.add(KEEB_T_TOKENS, 8)

    if (!hdr) {
      fail(KEEB_ERR_TOO_BIG)
      return
    }

    let listed = 0
    let next = start

    for (let id = start; id < TOKENS.length; id++) {
      const t = TOKENS[id]
      const name = t.name
      const rec = msg.add(KEEB_T_TOKENS, 6 + name.length)

      if (!rec) {
        break
      }

      rec.setUint16(0, id, true)
      rec.setUint16(2, 0, true)
      rec.setUint8(4, Math.min(name.length, KEEB_TOKEN_NAME_MAX))
      rec.setUint8(5, UNAVAILABLE_TOKENS.has(t.label) ? 0 : KEEB_TOKEN_F_READY)
      msg.buf.set(new TextEncoder().encode(name.slice(0, KEEB_TOKEN_NAME_MAX)), msg.len - Math.min(name.length, KEEB_TOKEN_NAME_MAX))

      listed++
      next = id + 1
    }

    hdr.setUint16(0, next < TOKENS.length ? next : 0xffff, true)
    hdr.setUint16(2, listed, true)
    hdr.setUint32(4, EXPECTED_TOKEN_HASH, true)
  }

  private writeTokenParams(msg: TlvMessage, value: Uint8Array, fail: (c: number) => void): void {
    if (value.length < 2) {
      fail(KEEB_ERR_BAD_LEN)
      return
    }

    const token = value[0] | (value[1] << 8)
    const def = TOKENS[token]

    if (!def) {
      fail(KEEB_ERR_UNKNOWN_TOKEN)
      return
    }

    /* The shape of ZMK's behavior metadata, from the same token table the
     * firmware lists: which params exist, and what kind of value they take. */
    const specs = paramSpecsFor(def.label)

    for (const spec of specs) {
      for (const v of spec.values) {
        const dv = msg.add(KEEB_T_TOKEN_PARAMS, 14 + v.name.length)

        if (!dv) {
          return
        }

        dv.setUint16(0, token, true)
        dv.setUint8(2, spec.param)
        dv.setUint8(3, v.type)
        dv.setUint32(4, v.a, true)
        dv.setUint32(8, v.b ?? 0, true)
        dv.setUint8(12, v.name.length)
        dv.setUint8(13, 0)
        msg.buf.set(new TextEncoder().encode(v.name), msg.len - v.name.length)
      }
    }
  }

  private writeCells(msg: TlvMessage, value: Uint8Array, fail: (c: number) => void): void {
    if (value.length < 1) {
      fail(KEEB_ERR_BAD_LEN)
      return
    }

    const layerId = value[0]

    if (layerId >= LAYER_CAPACITY) {
      fail(KEEB_ERR_OUT_OF_RANGE)
      return
    }

    const cells = this.cells.get(layerId) ?? []
    const dv = msg.add(KEEB_T_CELLS, 4 + KEY_COUNT * 16)

    if (!dv) {
      fail(KEEB_ERR_TOO_BIG)
      return
    }

    dv.setUint8(0, layerId)
    dv.setUint8(1, 0)
    dv.setUint16(2, KEY_COUNT, true)

    for (let pos = 0; pos < KEY_COUNT; pos++) {
      const at = 4 + pos * 16
      const cell = cells[pos]

      dv.setUint8(at, layerId)
      dv.setUint8(at + 1, RESERVED_POSITIONS.includes(pos) ? KEEB_CELL_F_RESERVED : 0)
      dv.setUint16(at + 2, pos, true)
      dv.setUint16(at + 4, cell ? cell.token : KEEB_TOKEN_NONE, true)
      dv.setUint16(at + 6, 0, true)
      dv.setUint32(at + 8, cell?.param1 ?? 0, true)
      dv.setUint32(at + 12, cell?.param2 ?? 0, true)
    }
  }

  private applyCells(value: Uint8Array, fail: (c: number) => void): number {
    if (value.length < 4) {
      fail(KEEB_ERR_BAD_LEN)
      return 0
    }

    const layerId = value[0]
    const count = value[2] | (value[3] << 8)

    if (layerId >= LAYER_CAPACITY) {
      fail(KEEB_ERR_OUT_OF_RANGE)
      return 0
    }

    if (value.length !== 4 + count * 16 || count > KEY_COUNT) {
      fail(KEEB_ERR_BAD_LEN)
      return 0
    }

    const cells = this.cells.get(layerId) ?? []
    const parsed: MockCell[] = []

    /* Validate everything, then write everything — the all-or-nothing rule in
     * keeb_keymap_set_cells. */
    for (let i = 0; i < count; i++) {
      const at = 4 + i * 16
      const dv = new DataView(value.buffer, value.byteOffset + at, 16)
      const pos = dv.getUint16(0, true)
      const token = dv.getUint16(4, true)
      const param1 = dv.getUint32(8, true)
      const param2 = dv.getUint32(12, true)

      if (pos >= KEY_COUNT) {
        fail(KEEB_ERR_OUT_OF_RANGE)
        return 0
      }

      if (RESERVED_POSITIONS.includes(pos)) {
        fail(KEEB_ERR_RESERVED_POSITION)
        return 0
      }

      if (!cells[pos]) {
        fail(KEEB_ERR_OUT_OF_RANGE)
        return 0
      }

      if (token === KEEB_TOKEN_NONE || token === KEEB_TOKEN_UNKNOWN || token >= TOKENS.length) {
        fail(KEEB_ERR_UNKNOWN_TOKEN)
        return 0
      }

      if (UNAVAILABLE_TOKENS.has(TOKENS[token].label)) {
        fail(KEEB_ERR_BEHAVIOR)
        return 0
      }

      parsed.push({ pos, token, param1, param2 })
    }

    for (const c of parsed) {
      cells[c.pos] = c
    }

    this.cells.set(layerId, cells)

    return parsed.length
  }

  private writeLayers(msg: TlvMessage): void {
    const dv = msg.add(KEEB_T_LAYERS, 14 + LAYER_CAPACITY)

    if (!dv) {
      return
    }

    let active = 0xffff

    for (let id = 0; id < LAYER_CAPACITY; id++) {
      if (this.layerState & (1 << id)) {
        active = id
      }
    }

    dv.setUint16(0, LAYER_CAPACITY, true)
    dv.setUint16(2, active, true)
    dv.setUint32(4, this.layerState, true)
    dv.setUint32(8, this.locked, true)
    dv.setUint8(12, 0)
    dv.setUint8(13, LAYER_NAME_MAX)

    for (let i = 0; i < LAYER_CAPACITY; i++) {
      dv.setUint8(14 + i, this.order[i])
    }

    for (let id = 0; id < LAYER_CAPACITY; id++) {
      const name = this.names.get(id)

      if (!name) {
        continue
      }

      const enc = new TextEncoder().encode(name)
      const ndv = msg.add(KEEB_T_LAYER_NAME_SET, 1 + enc.length)

      if (!ndv) {
        return
      }

      ndv.setUint8(0, id)
      msg.buf.set(enc, msg.len - enc.length)
    }
  }

  private setLayerName(value: Uint8Array, fail: (c: number) => void): void {
    if (value.length < 1) {
      fail(KEEB_ERR_BAD_LEN)
      return
    }

    const id = value[0]
    const name = new TextDecoder().decode(value.subarray(1))

    if (id >= LAYER_CAPACITY) {
      fail(KEEB_ERR_OUT_OF_RANGE)
      return
    }

    if (name.length >= LAYER_NAME_MAX) {
      fail(KEEB_ERR_BAD_LEN)
      return
    }

    this.names.set(id, name)
    this.notify(KEEB_EV_LAYER_CHANGED, u8(id))
  }

  private moveLayer(value: Uint8Array, fail: (c: number) => void): void {
    if (value.length < 2) {
      fail(KEEB_ERR_BAD_LEN)
      return
    }

    const from = value[0]
    const to = value[1]

    if (from >= LAYER_CAPACITY || to >= LAYER_CAPACITY) {
      fail(KEEB_ERR_OUT_OF_RANGE)
      return
    }

    const [moved] = this.order.splice(from, 1)
    this.order.splice(to, 0, moved)
    this.notify(KEEB_EV_LAYER_CHANGED, new Uint8Array())
  }

  private addLayer(): number {
    const seen = new Set(this.order.filter((id) => id !== LAYER_ID_INVALID))

    for (let index = 0; index < LAYER_CAPACITY; index++) {
      if (this.order[index] !== LAYER_ID_INVALID) {
        continue
      }

      for (let id = 0; id < LAYER_CAPACITY; id++) {
        if (!seen.has(id)) {
          this.order[index] = id
          if (!this.cells.has(id)) {
            this.cells.set(id, Array.from({ length: KEY_COUNT }, (_, pos) => ({ pos, token: 1, param1: 0, param2: 0 })))
          }
          if (!this.names.has(id)) {
            this.names.set(id, STOCK_LAYER_NAMES[id] ?? `L${id}`)
          }
          return index
        }
      }
    }

    return -1
  }

  private removeLayer(index: number, fail: (c: number) => void): void {
    if (index >= LAYER_CAPACITY) {
      fail(KEEB_ERR_OUT_OF_RANGE)
      return
    }

    if (this.order[index] === LAYER_ID_INVALID) {
      fail(KEEB_ERR_OUT_OF_RANGE)
      return
    }

    while (index < LAYER_CAPACITY - 1) {
      this.order[index] = this.order[index + 1]
      index++
    }

    this.order[LAYER_CAPACITY - 1] = LAYER_ID_INVALID
    this.notify(KEEB_EV_LAYER_CHANGED, new Uint8Array())
  }

  private restoreLayer(id: number, index: number, fail: (c: number) => void): void {
    if (index >= LAYER_CAPACITY || id >= LAYER_CAPACITY) {
      fail(KEEB_ERR_OUT_OF_RANGE)
      return
    }

    for (let i = LAYER_CAPACITY - 1; i > index; i--) {
      this.order[i] = this.order[i - 1]
    }

    this.order[index] = id
    this.notify(KEEB_EV_LAYER_CHANGED, new Uint8Array())
  }

  private snapshot() {
    return {
      order: [...this.order],
      names: new Map(this.names),
      cells: new Map([...this.cells].map(([id, cells]) => [id, cells.map((c) => ({ ...c }))])),
    }
  }

  private save(): void {
    this.persisted = this.snapshot()
    this.notify(KEEB_EV_SAVED, new Uint8Array())
  }

  private discard(): void {
    if (this.persisted) {
      this.order = [...this.persisted.order]
      this.names = new Map(this.persisted.names)
      this.cells = new Map([...this.persisted.cells].map(([id, cells]) => [id, cells.map((c) => ({ ...c }))]))
    } else {
      /* No saved subtree: DISCARD falls back to the keymap file, which is what
       * this instance was seeded from. */
      this.order = STOCK_LAYER_NAMES.map((_, i) => i)
      this.names = new Map(STOCK_LAYER_NAMES.map((n, i) => [i, n]))
      this.cells = new Map(
        STOCK_LAYERS.map((l, id) => [id, l.cells.map((c, pos) => ({ pos, ...c }))]),
      )
    }

    this.notify(KEEB_EV_DISCARDED, new Uint8Array())
  }

  private reset(): void {
    this.persisted = null
    this.discard()
  }

  /* ------------------------------------------------------------------ settings */

  private writeSettings(msg: TlvMessage): void {
    const dv = msg.add(KEEB_T_SETTINGS, KEEB_SETTINGS_SIZE)

    if (!dv) {
      return
    }

    dv.setUint32(0, this.settings.idleTimeoutMs, true)
    dv.setUint32(4, this.settings.sleepTimeoutMs, true)
    dv.setUint32(8, this.settings.debouncePressMs, true)
    dv.setUint32(12, this.settings.debounceReleaseMs, true)
    dv.setInt32(16, this.settings.tappingTermMs, true)
    dv.setInt32(20, this.settings.quickTapMs, true)
    dv.setInt32(24, this.settings.priorIdleMs, true)
    dv.setUint32(28, this.settings.ledBrightnessPercent, true)
    dv.setUint32(32, this.settings.ledColorRed, true)
    dv.setUint32(36, this.settings.ledColorGreen, true)
    dv.setUint32(40, this.settings.ledColorBlue, true)
    this.settings.ledLayerColors.forEach((c, i) => dv.setUint32(44 + 4 * i, c, true))
    dv.setUint16(76, this.settings.flags & 0xffff, true)
    dv.setUint8(78, this.settings.booleans)
    dv.setUint8(79, this.settings.holdTapFlavor)
  }

  /** keeb_settings_set(): a fixed-size record, fields written only where the
   * flag is set, unknown flags/hold-tap flavor refused. */
  private applySettings(value: Uint8Array, fail: (code: number) => void): void {
    if (value.length < KEEB_SETTINGS_SIZE) {
      fail(KEEB_ERR_BAD_LEN)

      return
    }

    const incoming = readSettings(value)

    if ((incoming.flags & ~KEEB_SETTINGS_F_ALL) !== 0) {
      fail(KEEB_ERR_OUT_OF_RANGE)

      return
    }

    if ((incoming.booleans & ~KEEB_SETTINGS_B_ALL) !== 0) {
      fail(KEEB_ERR_OUT_OF_RANGE)

      return
    }

    if (incoming.holdTapFlavor > 3 && incoming.holdTapFlavor !== KEEB_SETTINGS_FLAVOR_AUTO) {
      fail(KEEB_ERR_OUT_OF_RANGE)

      return
    }

    const setBool = (bit: number): void => {
      if (incoming.booleans & bit) {
        this.settings.booleans |= bit
      } else {
        this.settings.booleans &= ~bit
      }
    }

    if (incoming.flags & KEEB_SETTINGS_F_IDLE_TIMEOUT) this.settings.idleTimeoutMs = incoming.idleTimeoutMs
    if (incoming.flags & KEEB_SETTINGS_F_SLEEP_TIMEOUT) this.settings.sleepTimeoutMs = incoming.sleepTimeoutMs
    if (incoming.flags & KEEB_SETTINGS_F_DEBOUNCE_PRESS) this.settings.debouncePressMs = incoming.debouncePressMs
    if (incoming.flags & KEEB_SETTINGS_F_DEBOUNCE_RELEASE) this.settings.debounceReleaseMs = incoming.debounceReleaseMs
    if (incoming.flags & KEEB_SETTINGS_F_TAPPING_TERM) this.settings.tappingTermMs = incoming.tappingTermMs
    if (incoming.flags & KEEB_SETTINGS_F_QUICK_TAP) this.settings.quickTapMs = incoming.quickTapMs
    if (incoming.flags & KEEB_SETTINGS_F_PRIOR_IDLE) this.settings.priorIdleMs = incoming.priorIdleMs
    if (incoming.flags & KEEB_SETTINGS_F_HOLD_TAP_FLAVOR) this.settings.holdTapFlavor = incoming.holdTapFlavor
    if (incoming.flags & KEEB_SETTINGS_F_LED_BRIGHTNESS) this.settings.ledBrightnessPercent = Math.min(100, incoming.ledBrightnessPercent)
    if (incoming.flags & KEEB_SETTINGS_F_LED_COLOR_RED) this.settings.ledColorRed = incoming.ledColorRed & 0xffffff
    if (incoming.flags & KEEB_SETTINGS_F_LED_COLOR_GREEN) this.settings.ledColorGreen = incoming.ledColorGreen & 0xffffff
    if (incoming.flags & KEEB_SETTINGS_F_LED_COLOR_BLUE) this.settings.ledColorBlue = incoming.ledColorBlue & 0xffffff
    if (incoming.flags & KEEB_SETTINGS_F_LED_LAYERS) {
      this.settings.ledLayerColors = incoming.ledLayerColors.map((c) => c & 0xffffff)
    }
    if (incoming.flags & KEEB_SETTINGS_F_SLEEP_ALLOWED) setBool(KEEB_SETTINGS_B_SLEEP_ALLOWED)
    if (incoming.flags & KEEB_SETTINGS_F_BLANK_ON_IDLE) setBool(KEEB_SETTINGS_B_BLANK_ON_IDLE)

    this.settings.flags = incoming.flags

    this.notify(KEEB_EV_SETTINGS_CHANGED, new Uint8Array([incoming.flags & 0xff, (incoming.flags >> 8) & 0xff]))
  }

  private discardSettings(): void {
    this.settings = { ...DEFAULT_SETTINGS, ledLayerColors: [...DEFAULT_SETTINGS.ledLayerColors] }
    this.tunes = DEFAULT_TUNES.map((t) => t.map((s) => ({ ...s })))
    this.soundMap = [...DEFAULT_SOUND_MAP]
    this.settingsSaved = false

    this.notify(KEEB_EV_SETTINGS_CHANGED, new Uint8Array([KEEB_SETTINGS_F_ALL & 0xff, (KEEB_SETTINGS_F_ALL >> 8) & 0xff]))
  }

  /** Test hook: what SETTINGS_SAVE has written, mirroring `savedToSettings`. */
  get settingsSavedToFlash(): boolean {
    return this.settingsSaved
  }

  /** Test hook: the RAM values ZMK reads. */
  settingsLive(): SettingsPayload {
    return { ...this.settings, booleans: this.settings.booleans }
  }

  /* ---------------------------------------------------------------- sound */

  private writeSound(msg: TlvMessage): void {
    for (let event = 0; event < KEEB_SOUND_EVENT_COUNT; event++) {
      const dv = msg.add(KEEB_T_SOUND_MAP, KEEB_SOUND_MAP_SIZE)

      if (!dv) {
        return
      }

      dv.setUint8(0, event)
      dv.setUint8(1, this.soundMap[event] ?? 0)
    }

    for (let tune = 0; tune < KEEB_SOUND_TUNE_COUNT; tune++) {
      const steps = this.tunes[tune] ?? []
      const dv = msg.add(KEEB_T_TUNE, KEEB_TUNE_HDR_SIZE + steps.length * KEEB_TUNE_STEP_SIZE)

      if (!dv) {
        return
      }

      dv.setUint8(0, tune)
      dv.setUint8(1, steps.length)
      dv.setUint16(2, 0, true)

      steps.forEach((step, i) => {
        const at = KEEB_TUNE_HDR_SIZE + i * KEEB_TUNE_STEP_SIZE
        dv.setUint16(at, step.pitchPct, true)
        dv.setUint16(at + 2, step.onMs, true)
        dv.setUint16(at + 4, step.gapMs, true)
      })
    }
  }

  /** Mirrors zmk_buzzer_tune_set(): the whole tune is refused if one step is
   * outside the piezo's ranges, so a bad write never half-lands. */
  private applyTune(value: Uint8Array, fail: (err: number) => void): void {
    if (value.length < KEEB_TUNE_HDR_SIZE) {
      fail(KEEB_ERR_BAD_LEN)
      return
    }

    const tune = value[0]
    const count = value[1]

    if (
      tune <= 0 ||
      tune >= KEEB_SOUND_TUNE_COUNT ||
      count < 1 ||
      count > KEEB_SOUND_STEPS_MAX ||
      value.length < KEEB_TUNE_HDR_SIZE + count * KEEB_TUNE_STEP_SIZE
    ) {
      fail(KEEB_ERR_OUT_OF_RANGE)
      return
    }

    const dv = new DataView(value.buffer, value.byteOffset, value.byteLength)
    const steps: TuneStep[] = []

    for (let i = 0; i < count; i++) {
      const at = KEEB_TUNE_HDR_SIZE + i * KEEB_TUNE_STEP_SIZE
      const step = {
        pitchPct: dv.getUint16(at, true),
        onMs: dv.getUint16(at + 2, true),
        gapMs: dv.getUint16(at + 4, true),
      }

      if (step.pitchPct < 50 || step.pitchPct > 400 || step.onMs < 10 || step.onMs > 1000 || step.gapMs > 1000) {
        fail(KEEB_ERR_OUT_OF_RANGE)
        return
      }

      steps.push(step)
    }

    this.tunes[tune] = steps
  }

  private applySoundMap(value: Uint8Array, fail: (err: number) => void): void {
    if (value.length < KEEB_SOUND_MAP_SIZE) {
      fail(KEEB_ERR_BAD_LEN)
      return
    }

    const event = value[0]
    const tune = value[1]

    if (event >= KEEB_SOUND_EVENT_COUNT || tune >= KEEB_SOUND_TUNE_COUNT) {
      fail(KEEB_ERR_OUT_OF_RANGE)
      return
    }

    this.soundMap[event] = tune
  }

  private playTune(value: Uint8Array): void {
    if (value.length >= KEEB_SOUND_PLAY_SIZE && value[0] < KEEB_SOUND_TUNE_COUNT) {
      this.tunePlays.push(value[0])
    }
  }

  /** Test hook: the RAM the buzzer would play. */
  soundLive(): SoundPayload {
    const tunes: Record<number, TuneStep[]> = {}

    for (let tune = 0; tune < KEEB_SOUND_TUNE_COUNT; tune++) {
      tunes[tune] = (this.tunes[tune] ?? []).map((s) => ({ ...s }))
    }

    return { events: { ...this.soundMap.reduce<Record<number, number>>((m, t, i) => ({ ...m, [i]: t }), {}) }, tunes }
  }

  /** Test hook: tune ids the host asked to hear, in order. */
  tunePlayed(): number[] {
    return [...this.tunePlays]
  }

  private sendAck(msgId: number, status: number, err: number): void {
    const msg = new TlvMessage()
    const dv = msg.add(KEEB_T_ACK, 10)

    if (!dv) {
      return
    }

    dv.setUint16(0, msgId, true)
    dv.setUint8(2, status)
    dv.setUint8(3, err)
    dv.setUint16(4, 0, true)
    dv.setUint32(6, 0, true)

    this.sender.sendAll(msg.bytes(), msgId, KEEB_PKT_F_REPLY)
  }

  /** Kept separate so the "reply is owed" rule can be tested without a clock. */
  owesReply(): boolean {
    return this.sender.busy
  }
}

/* --------------------------------------------------------------------------
 * Param metadata, derived from the token table's binding cells.
 * -------------------------------------------------------------------------- */

interface ParamValueSpec {
  type: number
  a: number
  b?: number
  name: string
}

interface ParamSpec {
  param: 0 | 1
  values: ParamValueSpec[]
}

function paramSpecsFor(label: string): ParamSpec[] {
  switch (label) {
    case 'kp':
    case 'kt':
    case 'sk':
      return [{ param: 0, values: [{ type: BEHAVIOR_PARAMETER_VALUE_TYPE_HID_USAGE, a: 0, b: 0xffff, name: 'keycode' }] }]
    case 'mo':
    case 'to':
    case 'tog':
    case 'sl':
    case 'layer_art':
      return [{ param: 0, values: [{ type: BEHAVIOR_PARAMETER_VALUE_TYPE_LAYER_ID, a: 0, b: LAYER_CAPACITY - 1, name: 'layer' }] }]
    case 'lt':
      return [
        { param: 0, values: [{ type: BEHAVIOR_PARAMETER_VALUE_TYPE_LAYER_ID, a: 0, b: LAYER_CAPACITY - 1, name: 'layer' }] },
        { param: 1, values: [{ type: BEHAVIOR_PARAMETER_VALUE_TYPE_HID_USAGE, a: 0, b: 0xffff, name: 'keycode' }] },
      ]
    case 'mt':
    case 'hml':
    case 'hmr':
      return [
        { param: 0, values: [{ type: BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, a: 0, b: 0xff, name: 'modifier' }] },
        { param: 1, values: [{ type: BEHAVIOR_PARAMETER_VALUE_TYPE_HID_USAGE, a: 0, b: 0xffff, name: 'keycode' }] },
      ]
    case 'mmv':
    case 'msc':
      return [{ param: 0, values: [{ type: BEHAVIOR_PARAMETER_VALUE_TYPE_RANGE, a: 0, b: 0xffffffff, name: 'move/scroll vector' }] }]
    case 'mkp':
      return [{ param: 0, values: [{ type: BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, a: 0, b: 0x1f, name: 'button mask' }] }]
    case 'bt':
      return [
        {
          param: 0,
          values: [
            { type: BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, a: 0, name: 'clear' },
            { type: BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, a: 1, name: 'next' },
            { type: BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, a: 2, name: 'previous' },
            { type: BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, a: 3, name: 'select' },
            { type: BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, a: 4, name: 'clear all' },
            { type: BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, a: 5, name: 'disconnect' },
          ],
        },
        { param: 1, values: [{ type: BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, a: 0, b: 4, name: 'profile' }] },
      ]
    case 'out':
      return [
        {
          param: 0,
          values: [
            { type: BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, a: 0, name: 'toggle' },
            { type: BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, a: 1, name: 'usb' },
            { type: BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, a: 2, name: 'ble' },
            { type: BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, a: 3, name: 'none' },
          ],
        },
      ]
    default:
      return []
  }
}

const u32 = (v: number): Uint8Array => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, v, true)
  return b
}

const u8 = (v: number): Uint8Array => new Uint8Array([v & 0xff])
