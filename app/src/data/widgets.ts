/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * The panel's vocabulary, as the editor shows it.
 *
 * The names live here rather than in the store because they are UI text, not
 * protocol: the protocol's numbers are in proto/constants.ts, and which kinds
 * and sources this particular keyboard can draw is answered by DISPLAY_INFO at
 * connect time. What this file adds is a label and a source filter per kind, so
 * the editor cannot offer a widget the firmware would refuse — the same trick
 * the key picker uses with the token table.
 */

import {
  KEEB_SRC_BATT_LEFT,
  KEEB_SRC_BATT_LEFT_PCT,
  KEEB_SRC_BATT_RIGHT,
  KEEB_SRC_BATT_RIGHT_PCT,
  KEEB_SRC_CHARGING,
  KEEB_SRC_DEVICE_ID,
  KEEB_SRC_DEVICE_NAME,
  KEEB_SRC_HOST,
  KEEB_SRC_LAYER_ART,
  KEEB_SRC_LAYER_INDEX,
  KEEB_SRC_LAYER_NAME,
  KEEB_SRC_LAYER_PIPS,
  KEEB_SRC_LAYER_POS,
  KEEB_SRC_LINK,
  KEEB_SRC_LINK_SHORT,
  KEEB_SRC_NONE,
  KEEB_WID_ART,
  KEEB_WID_BAR,
  KEEB_WID_BATTERY,
  KEEB_WID_BOLT,
  KEEB_WID_FRAME,
  KEEB_WID_NONE,
  KEEB_WID_PIPS,
  KEEB_WID_RECT,
  KEEB_WID_RULE,
  KEEB_WID_TEXT,
} from '../proto/constants.ts'

export const KIND_LABELS: Record<number, string> = {
  [KEEB_WID_NONE]: 'empty',
  [KEEB_WID_FRAME]: 'frame',
  [KEEB_WID_RECT]: 'fill',
  [KEEB_WID_RULE]: 'rule',
  [KEEB_WID_TEXT]: 'text',
  [KEEB_WID_BAR]: 'bar',
  [KEEB_WID_BATTERY]: 'battery',
  [KEEB_WID_PIPS]: 'pips',
  [KEEB_WID_BOLT]: 'bolt',
  [KEEB_WID_ART]: 'artwork',
}

/** Ordered list the kind picker offers. */
export const KIND_ORDER = [
  KEEB_WID_TEXT,
  KEEB_WID_FRAME,
  KEEB_WID_RECT,
  KEEB_WID_RULE,
  KEEB_WID_BAR,
  KEEB_WID_BATTERY,
  KEEB_WID_PIPS,
  KEEB_WID_BOLT,
  KEEB_WID_ART,
]

export const SOURCE_LABELS: Record<number, string> = {
  [KEEB_SRC_NONE]: '—',
  [KEEB_SRC_LAYER_INDEX]: 'layer number',
  [KEEB_SRC_LAYER_NAME]: 'layer name',
  [KEEB_SRC_LAYER_POS]: 'layer x / y',
  [KEEB_SRC_LAYER_PIPS]: 'layer pips',
  [KEEB_SRC_LAYER_ART]: 'layer artwork',
  [KEEB_SRC_BATT_LEFT]: 'left battery %',
  [KEEB_SRC_BATT_LEFT_PCT]: 'left battery text',
  [KEEB_SRC_BATT_RIGHT]: 'right battery %',
  [KEEB_SRC_BATT_RIGHT_PCT]: 'right battery text',
  [KEEB_SRC_LINK]: 'split link',
  [KEEB_SRC_LINK_SHORT]: 'split link (short)',
  [KEEB_SRC_HOST]: 'host link',
  [KEEB_SRC_CHARGING]: 'charging / host',
  [KEEB_SRC_DEVICE_ID]: 'connected device',
  [KEEB_SRC_DEVICE_NAME]: 'device name',
}

/** Sources a kind can actually be fed from — the same pairing rule
 * kind_source_ok() in keeb-module/.../widget_model.c enforces. */
export function sourcesForKind(kind: number, srcBase: number, srcValue: number): number[] {
  switch (kind) {
    case KEEB_WID_TEXT:
      return [
        KEEB_SRC_LAYER_INDEX,
        KEEB_SRC_LAYER_NAME,
        KEEB_SRC_LAYER_POS,
        KEEB_SRC_BATT_LEFT_PCT,
        KEEB_SRC_BATT_RIGHT_PCT,
        KEEB_SRC_LINK,
        KEEB_SRC_LINK_SHORT,
        KEEB_SRC_HOST,
        KEEB_SRC_CHARGING,
        KEEB_SRC_DEVICE_ID,
        KEEB_SRC_DEVICE_NAME,
        srcBase,
      ]
    case KEEB_WID_BAR:
    case KEEB_WID_BATTERY:
      return [KEEB_SRC_BATT_LEFT, KEEB_SRC_BATT_RIGHT, srcValue]
    case KEEB_WID_PIPS:
      return [KEEB_SRC_LAYER_PIPS]
    case KEEB_WID_ART:
      return [KEEB_SRC_LAYER_ART]
    default:
      return [KEEB_SRC_NONE]
  }
}

export const FONT_LABELS = ['small (8)', 'body (16)', 'large (26)']
export const ALIGN_LABELS = ['left', 'center', 'right']
export const PIPS_LABELS = ['small 6x3', 'large 7x4', 'tiny 5x3']

export const KIND_STYLE_HELP: Record<number, string> = {
  [KEEB_WID_FRAME]: 'corner radius, px',
  [KEEB_WID_RECT]: '0 = ink, 1 = paper',
  [KEEB_WID_TEXT]: 'font + alignment',
  [KEEB_WID_PIPS]: 'pip size preset',
  [KEEB_WID_ART]: '0 = centre, 1 = bottom',
}

export function isTextSlot(source: number, base: number, slots: number): boolean {
  return source >= base && source < base + slots
}

export function slotIndexOf(source: number, base: number): number {
  return source - base
}

/** One line describing a widget for the list rows. */
export function describeWidget(
  kind: number,
  source: number,
  textBase: number,
  valueBase: number,
  textSlots: number,
): string {
  const kindName = KIND_LABELS[kind] ?? `kind ${kind}`

  if (isTextSlot(source, textBase, textSlots)) {
    return `${kindName} ← text ${slotIndexOf(source, textBase)}`
  }

  if (source >= valueBase && source < valueBase + 4) {
    return `${kindName} ← value ${source - valueBase}`
  }

  return `${kindName} ← ${SOURCE_LABELS[source] ?? `source ${source}`}`
}
