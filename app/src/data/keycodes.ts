/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Picker catalog and cap labels.
 *
 * The numbers come from the generated table (zmk.gen.ts), which comes from
 * ZMK's own dt-bindings. What this file adds is only what the firmware does
 * not send: which names are worth showing in a picker, and how they should
 * look on a keycap.
 *
 * Every name listed here is checked against KEYCODES at import time. A name
 * that ZMK does not define is a bug in this file, not a value the keyboard
 * will happily accept, so it is reported instead of silently becoming 0.
 */

import { KEYCODES } from '../proto/zmk.gen.ts'

export interface KeyItem {
  name: string
  code: number
  label: string
}

const missing: string[] = []

function mk(name: string, label?: string): KeyItem {
  const code = KEYCODES[name]

  if (code === undefined) {
    missing.push(name)

    return { name, code: 0, label: label ?? name }
  }

  return { name, code, label: label ?? name }
}

export const MISSING_CATALOG_NAMES = missing

export const CATALOG = {
  letters: 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('').map((c) => mk(c)),
  numbers: '1234567890'.split('').map((d) => mk(`N${d}`, d)),
  symbols: [
    /* Unshifted usages only. In ZMK, LBRC/RBRC are LS(...) — they send { and }
     * — so the brackets are LBKT/RBKT, and the backslash is BSLH: ZMK has no
     * BSLS. */
    mk('MINUS', '-'), mk('EQUAL', '='), mk('GRAVE', '`'), mk('LBKT', '['), mk('RBKT', ']'),
    mk('BSLH', '\\'), mk('SEMI', ';'), mk('QUOT', "'"), mk('COMMA', ','), mk('DOT', '.'),
    mk('FSLH', '/'), mk('SPACE', '␣'), mk('RET', '⏎'), mk('BKSP', '⌫'), mk('TAB', '⇆'),
    mk('ESC', '⎋'),
  ],
  shifted: [
    mk('EXCLAMATION', '!'), mk('AT_SIGN', '@'), mk('HASH', '#'), mk('DOLLAR', '$'),
    mk('PERCENT', '%'), mk('CARET', '^'), mk('AMPERSAND', '&'), mk('ASTERISK', '*'),
    mk('LEFT_PARENTHESIS', '('), mk('RIGHT_PARENTHESIS', ')'), mk('UNDERSCORE', '_'),
    mk('PLUS', '+'), mk('LEFT_BRACE', '{'), mk('RIGHT_BRACE', '}'), mk('PIPE', '|'),
    mk('COLON', ':'), mk('DOUBLE_QUOTES', '"'), mk('LT', '<'), mk('GT', '>'), mk('QUESTION', '?'),
    mk('TILDE', '~'),
  ],
  modifiers: [
    mk('LCTRL', 'LCtrl'), mk('LSHFT', 'LShift'), mk('LALT', 'LAlt'), mk('LGUI', 'LGui'),
    mk('RCTRL', 'RCtrl'), mk('RSHFT', 'RShift'), mk('RALT', 'RAlt'), mk('RGUI', 'RGui'),
  ],
  navigation: [
    mk('HOME', 'Home'), mk('END', 'End'), mk('PGUP', 'PgUp'), mk('PGDN', 'PgDn'),
    mk('UP', '↑'), mk('DOWN', '↓'), mk('LEFT', '←'), mk('RIGHT', '→'),
    mk('INS', 'Ins'), mk('DEL', 'Del'), mk('CAPSLOCK', 'Caps'), mk('PRINTSCREEN', 'PrtSc'),
  ],
  function: Array.from({ length: 12 }, (_, i) => mk(`F${i + 1}`)),
  media: [
    mk('K_PLAY_PAUSE', '⏯'), mk('K_NEXT', '⏭'), mk('K_PREV', '⏮'), mk('K_STOP', '⏹'),
    mk('K_MUTE', '🔇'), mk('K_VOLUME_UP', '🔉+'), mk('K_VOLUME_DOWN', '🔉−'),
    mk('C_BRIGHTNESS_INC', '☀+'), mk('C_BRIGHTNESS_DEC', '☀−'),
  ],
  keypad: [
    mk('KP_ENTER', '⏎'), mk('KP_DIVIDE', '/'), mk('KP_ASTERISK', '*'), mk('KP_PLUS', '+'),
    mk('KP_MINUS', '−'), mk('KP_DOT', '.'),
    mk('KP_N0', '0'), mk('KP_N1', '1'), mk('KP_N2', '2'), mk('KP_N3', '3'),
    mk('KP_N4', '4'), mk('KP_N5', '5'), mk('KP_N6', '6'),
    mk('KP_N7', '7'), mk('KP_N8', '8'), mk('KP_N9', '9'),
  ],
  mouseButtons: [
    mk('LCLK', 'LClick'), mk('RCLK', 'RClick'), mk('MCLK', 'MClick'), mk('MB4', 'B4'), mk('MB5', 'B5'),
  ],
  mouseMove: [
    mk('MOVE_UP', '↑'), mk('MOVE_DOWN', '↓'), mk('MOVE_LEFT', '←'), mk('MOVE_RIGHT', '→'),
  ],
  mouseScroll: [mk('SCRL_UP', '↑'), mk('SCRL_DOWN', '↓'), mk('SCRL_LEFT', '←'), mk('SCRL_RIGHT', '→')],
  bluetooth: [
    mk('BT_CLR', 'clear'), mk('BT_NXT', 'next'), mk('BT_PRV', 'prev'), mk('BT_SEL', 'select'),
    mk('BT_CLR_ALL', 'clear all'), mk('BT_DISC', 'disconnect'),
  ],
  outputs: [mk('OUT_TOG', 'toggle'), mk('OUT_USB', 'USB'), mk('OUT_BLE', 'BLE'), mk('OUT_NONE', 'none')],
}

/* --------------------------------------------------------------------------
 * Cap labels
 * -------------------------------------------------------------------------- */

const SHORT_LABELS: Record<string, string> = {
  SPACE: '␣', RET: '⏎', BKSP: '⌫', TAB: '⇆', ESC: '⎋',
  UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→',
  LCTRL: 'LCtrl', LSHFT: 'LSh', LALT: 'LAlt', LGUI: 'LGui',
  RCTRL: 'RCtrl', RSHFT: 'RSh', RALT: 'RAlt', RGUI: 'RGui',
  CAPSLOCK: 'Caps', HOME: 'Home', END: 'End', PGUP: 'Pg↑', PGDN: 'Pg↓',
  MINUS: '-', EQUAL: '=', GRAVE: '`', LBKT: '[', RBKT: ']', BSLH: '\\',
  LBRC: '{', RBRC: '}', PIPE: '|',
  SEMI: ';', QUOT: "'", COMMA: ',', DOT: '.', FSLH: '/',
  K_PLAY_PAUSE: '⏯', K_NEXT: '⏭', K_PREV: '⏮', K_MUTE: '🔇',
  K_VOLUME_UP: '🔉+', K_VOLUME_DOWN: '🔉−',
}

/* --------------------------------------------------------------------------
 * Display labels: code value → what to print on a cap.  This is decoupled
 * from ZMK naming aliases so a cryptic abbreviation like SQT or GRAV never
 * leaks into the UI as the primary label.
 * -------------------------------------------------------------------------- */

const DISPLAY_LABELS: Record<number, string | undefined> = {}

function registerLabel(code: number, label: string): void {
  if (DISPLAY_LABELS[code] === undefined) {
    DISPLAY_LABELS[code] = label
  }
}

for (const [name, label] of Object.entries(SHORT_LABELS)) {
  const code = KEYCODES[name]

  if (code !== undefined) {
    registerLabel(code, label)
  }
}

for (const group of Object.values(CATALOG)) {
  for (const item of group) {
    registerLabel(item.code, item.label)
  }
}

/* --------------------------------------------------------------------------
 * Name lookup: value → ZMK name.  Several names can encode the same usage
 * (LS(N1) and EXCLAMATION); we prefer names that are known in SHORT_LABELS
 * or CATALOG so the shortest cryptic alias (GRAV vs GRAVE) is not the one
 * used for hints.
 * -------------------------------------------------------------------------- */

const KNOWN_NAMES = new Set<string>([
  ...Object.keys(SHORT_LABELS),
  ...Object.values(CATALOG).flatMap((g) => g.map((i) => i.name)),
])

const nameByCode = new Map<number, string>()
const preferredNameByCode = new Map<number, string>() // readable / known name

for (const [name, value] of Object.entries(KEYCODES)) {
  const existing = nameByCode.get(value)

  if (!existing) {
    nameByCode.set(value, name)
    if (KNOWN_NAMES.has(name)) preferredNameByCode.set(value, name)
    continue
  }

  const existingKnown = KNOWN_NAMES.has(existing)
  const newKnown = KNOWN_NAMES.has(name)

  if (newKnown && !existingKnown) {
    nameByCode.set(value, name)
    preferredNameByCode.set(value, name)
  } else if (newKnown && existingKnown && name.length < existing.length) {
    nameByCode.set(value, name)
    preferredNameByCode.set(value, name)
  } else if (!newKnown && !existingKnown && name.length < existing.length) {
    nameByCode.set(value, name)
  }

  if (newKnown) {
    const preferred = preferredNameByCode.get(value)
    if (!preferred || name.length < preferred.length) {
      preferredNameByCode.set(value, name)
    }
  }
}

export function keyNameFor(code: number): string | null {
  return nameByCode.get(code) ?? null
}

/** A readable canonical ZMK name for tooltips and hints. */
export function keyHint(code: number): string | null {
  return preferredNameByCode.get(code) ?? nameByCode.get(code) ?? null
}

export function keyLabel(code: number): string {
  const direct = DISPLAY_LABELS[code]

  if (direct !== undefined) {
    return direct
  }

  const name = nameByCode.get(code)

  if (!name) {
    return `0x${code.toString(16)}`
  }

  return name.replace(/^K_|^C_/, '')
}

/* Mouse params are encoded vectors (pointing.h): x in the high half, y in the
 * low half, both signed. The labels below follow ZMK's own naming, where
 * MOVE_UP is a negative y and SCRL_UP a positive one. */
const moveX = (v: number): number => {
  const raw = (v & 0xffff0000) >> 16
  return raw & 0x8000 ? raw - 0x10000 : raw
}

const moveY = (v: number): number => {
  const raw = v & 0xffff
  return raw & 0x8000 ? raw - 0x10000 : raw
}

export function mouseMoveLabel(v: number): string {
  const x = moveX(v)
  const y = moveY(v)

  if (Math.abs(y) >= Math.abs(x)) {
    return y < 0 ? 'M↑' : y > 0 ? 'M↓' : 'M·'
  }

  return x < 0 ? 'M←' : 'M→'
}

export function mouseScrollLabel(v: number): string {
  const x = moveX(v)
  const y = moveY(v)

  if (Math.abs(y) >= Math.abs(x)) {
    return y > 0 ? 'S↑' : y < 0 ? 'S↓' : 'S·'
  }

  return x > 0 ? 'S→' : 'S←'
}

const BUTTON_NAMES = ['LCLK', 'RCLK', 'MCLK', 'MB4', 'MB5']

export function mouseButtonLabel(mask: number): string {
  const names = BUTTON_NAMES.filter((_, i) => mask & (1 << i))

  return names.length ? names.map((n) => SHORT_LABELS[n] ?? `🖱${n.slice(2)}`).join('+') : '🖱'
}

const BT_LABELS = ['BT clr', 'BT nxt', 'BT prv', 'BT sel', 'BT clr all', 'BT disc']
const OUT_LABELS = ['OUT tog', 'OUT USB', 'OUT BLE', 'OUT off']

export { BT_LABELS, OUT_LABELS }
