/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Turning a {token, param1, param2} binding into something a keycap can show.
 *
 * The firmware has no display model at all: a binding is a behavior plus two
 * uint32 params. Every label here is derived from the token table (which
 * behavior) and the generated keycode table (what the params mean), so a cap
 * is a *reading* of the layout, never a second copy of it.
 */

import { BT_LABELS, OUT_LABELS, keyHint, keyLabel, mouseButtonLabel, mouseMoveLabel, mouseScrollLabel } from '../data/keycodes.ts'
import { KEEB_TOKEN_NONE, KEEB_TOKEN_UNKNOWN } from '../proto/constants.ts'
import { NONE_TOKEN, TRANSPARENT_TOKEN } from '../stores/keymap.ts'
import { KEYCODES, TOKENS } from '../proto/zmk.gen.ts'
import type { Binding } from '../proto/types.ts'

export type CapCategory = 'key' | 'mod' | 'media' | 'nav' | 'mouse' | 'layer' | 'holdtap' | 'inherit' | 'off' | 'unknown' | 'system'

export interface CapDisplay {
  main: string
  /** hold side of a hold/tap cap, or the layer a layer behavior points at */
  hold: string | null
  category: CapCategory
  /** ZMK keycode name for key-related behaviors, shown as a secondary hint */
  hint: string | null
  /** devicetree label of the behavior, e.g. "&hml" */
  tokenLabel: string
  /** ZMK node name, e.g. "home_row_mod_left" — what the firmware stores */
  tokenName: string
}

const labelOf = (token: number): string => {
  const def = TOKENS.find((t) => t.id === token)

  return def ? `&${def.label}` : `#${token}`
}

const nameOf = (token: number): string => TOKENS.find((t) => t.id === token)?.name ?? `token ${token}`

const MOD_CODES = new Set(['LCTRL', 'LSHFT', 'LALT', 'LGUI', 'RCTRL', 'RSHFT', 'RALT', 'RGUI'].map((n) => KEYCODES[n]).filter((v) => v !== undefined))
const MEDIA_CODES = new Set(['K_PLAY_PAUSE', 'K_NEXT', 'K_PREV', 'K_STOP', 'K_MUTE', 'K_VOLUME_UP', 'K_VOLUME_DOWN', 'C_BRIGHTNESS_INC', 'C_BRIGHTNESS_DEC'].map((n) => KEYCODES[n]).filter((v) => v !== undefined))
const NAV_CODES = new Set(['HOME', 'END', 'PGUP', 'PGDN', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'INS', 'DEL', 'CAPSLOCK', 'PRINTSCREEN'].map((n) => KEYCODES[n]).filter((v) => v !== undefined))

function keyCategory(code: number): CapCategory {
  if (MOD_CODES.has(code)) return 'mod'
  if (MEDIA_CODES.has(code)) return 'media'
  if (NAV_CODES.has(code)) return 'nav'

  return 'key'
}

export function describeBinding(
  binding: Binding | null,
  layerName: (id: number) => string,
): CapDisplay {
  if (!binding) {
    return { main: '—', hold: null, hint: null, category: 'unknown', tokenLabel: '—', tokenName: 'no binding' }
  }

  const { token, param1, param2 } = binding
  const base = { tokenLabel: labelOf(token), tokenName: nameOf(token) }

  if (token === KEEB_TOKEN_NONE) {
    return { ...base, main: '', hold: null, hint: null, category: 'off', tokenName: 'grid slot not mapped' }
  }

  if (token === KEEB_TOKEN_UNKNOWN) {
    return { ...base, main: '???', hold: null, hint: null, category: 'unknown', tokenName: 'defined by the keymap file, not configurable over TLV' }
  }

  if (token === TRANSPARENT_TOKEN) {
    return { ...base, main: '⤒', hold: null, hint: null, category: 'inherit', tokenName: 'transparent (inherits the lower layer)' }
  }

  if (token === NONE_TOKEN) {
    return { ...base, main: '·', hold: null, hint: null, category: 'off', tokenName: 'no-op' }
  }

  const def = TOKENS.find((t) => t.id === token)
  const label = def?.label ?? ''

  switch (label) {
    case 'kp':
    case 'kt':
    case 'sk': {
      const main = keyLabel(param1)

      return { ...base, main, hold: label === 'kt' ? 'toggle' : label === 'sk' ? 'sticky' : null, hint: keyHint(param1), category: keyCategory(param1) }
    }

    case 'mo':
    case 'sl':
      return { ...base, main: label.toUpperCase(), hold: layerName(param1), hint: null, category: 'layer' }

    case 'to':
    case 'tog':
      return { ...base, main: label.toUpperCase(), hold: layerName(param1), hint: null, category: 'layer' }

    case 'lt': {
      const main = keyLabel(param2)
      return { ...base, main, hold: layerName(param1), hint: keyHint(param2), category: 'holdtap' }
    }

    case 'mt':
    case 'hml':
    case 'hmr': {
      const holdHint = keyHint(param1)
      const tapHint = keyHint(param2)
      const hint = holdHint && tapHint ? `${holdHint} / ${tapHint}` : tapHint ?? holdHint ?? null
      return { ...base, main: keyLabel(param2), hold: keyLabel(param1), hint, category: 'holdtap' }
    }

    case 'mmv':
      return { ...base, main: mouseMoveLabel(param1), hold: null, hint: null, category: 'mouse' }

    case 'msc':
      return { ...base, main: mouseScrollLabel(param1), hold: null, hint: null, category: 'mouse' }

    case 'mkp':
      return { ...base, main: mouseButtonLabel(param1), hold: null, hint: null, category: 'mouse' }

    case 'bt':
      return { ...base, main: BT_LABELS[param1] ?? `BT ${param1}`, hold: null, hint: null, category: 'system' }

    case 'out':
      return { ...base, main: OUT_LABELS[param1] ?? `OUT ${param1}`, hold: null, hint: null, category: 'system' }

    case 'sys_reset':
      return { ...base, main: 'Reset', hold: null, hint: null, category: 'system' }

    case 'bootloader':
      return { ...base, main: 'Boot', hold: null, hint: null, category: 'system' }

    case 'right_reset':
      return { ...base, main: 'R Reset', hold: null, hint: null, category: 'system' }

    case 'right_boot':
      return { ...base, main: 'R Boot', hold: null, hint: null, category: 'system' }

    case 'gresc':
      return { ...base, main: '⎋/`', hold: null, hint: null, category: 'holdtap' }

    case 'key_repeat':
      return { ...base, main: 'Repeat', hold: null, hint: null, category: 'system' }

    case 'caps_word':
      return { ...base, main: 'CapsW', hold: null, hint: null, category: 'system' }

    case 'layer_art':
      return { ...base, main: 'Art', hold: layerName(param1), hint: null, category: 'layer' }

    default:
      /* A token the keymap can bind but this UI has no rendering rule for yet.
       * Showing the raw params beats guessing. */
      return { ...base, main: `#${token}`, hold: `${param1},${param2}`, hint: null, category: 'unknown' }
  }
}

/* --------------------------------------------------------------------------
 * Param editing helpers for the picker
 * -------------------------------------------------------------------------- */

export type ParamKind = 'none' | 'keycode' | 'layer' | 'mouse-vector' | 'button-mask' | 'bt-cmd' | 'output' | 'number'

/** Which params a token takes, from the devicetree binding cells. When a
 * keyboard is connected the picker prefers the firmware's own
 * KEEB_T_TOKEN_PARAMS answer; this is the offline fallback. */
export function paramKinds(token: number): ParamKind[] {
  const def = TOKENS.find((t) => t.id === token)

  if (!def || def.bindingCells === 0) {
    return []
  }

  switch (def.label) {
    case 'kp':
    case 'kt':
    case 'sk':
      return ['keycode']
    case 'mo':
    case 'to':
    case 'tog':
    case 'sl':
    case 'layer_art':
      return ['layer']
    case 'lt':
      return ['layer', 'keycode']
    case 'mt':
    case 'hml':
    case 'hmr':
      return ['keycode', 'keycode']
    case 'mmv':
    case 'msc':
      return ['mouse-vector']
    case 'mkp':
      return ['button-mask']
    case 'bt':
      return ['bt-cmd', 'number']
    case 'out':
      return ['output']
    default:
      return def.bindingCells === 1 ? ['number'] : ['number', 'number']
  }
}

export const MODIFIER_NAMES = ['LCTRL', 'LSHFT', 'LALT', 'LGUI', 'RCTRL', 'RSHFT', 'RALT', 'RGUI']

export const tokenIsBindable = (token: number): boolean =>
  token !== KEEB_TOKEN_NONE && token !== KEEB_TOKEN_UNKNOWN && TOKENS.some((t) => t.id === token)
