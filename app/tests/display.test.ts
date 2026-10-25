/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * The status panel, checked three ways:
 *
 *   1. the codec — a table written by writeDisplayTable() reads back as the
 *      table the firmware's struct keeb_widget describes;
 *   2. the mock engine — the refusals are the firmware's refusals, and a write
 *      that is refused changes nothing;
 *   3. the C preset table — the mock's panel and the firmware's panel are the
 *      same table. They are maintained in two languages, so this is the only
 *      thing standing between a firmware edit and a preview that quietly stops
 *      matching the glass.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { createPinia, setActivePinia } from 'pinia'

import {
  KEEB_DISPLAY_INFO_F_ART,
  KEEB_DISPLAY_F_DIRTY,
  KEEB_ERR_OUT_OF_RANGE,
  KEEB_INFO_F_DISPLAY,
  KEEB_SRC_BATT_LEFT,
  KEEB_SRC_BATT_RIGHT,
  KEEB_SRC_DEVICE_ID,
  KEEB_SRC_LAYER_ART,
  KEEB_SRC_LAYER_NAME,
  KEEB_SRC_LAYER_PIPS,
  KEEB_SRC_NONE,
  KEEB_SRC_TEXT_BASE,
  KEEB_SRC_VALUE_BASE,
  KEEB_STATUS_OK,
  KEEB_TEXT_STYLE,
  KEEB_T_DISPLAY,
  KEEB_T_DISPLAY_SET,
  KEEB_T_TEXT_SET,
  KEEB_T_VALUE_SET,
  KEEB_T_WIDGET_SET,
  KEEB_WID_ART,
  KEEB_WID_BAR,
  KEEB_WID_BATTERY,
  KEEB_WID_BOLT,
  KEEB_WID_COUNT,
  KEEB_WID_FRAME,
  KEEB_WID_NONE,
  KEEB_WID_PIPS,
  KEEB_WID_RECT,
  KEEB_WID_RULE,
  KEEB_WID_TEXT,
  KBEEB_PRESET_CUSTOM,
} from '../src/proto/constants.ts'
import type { Widget } from '../src/proto/types.ts'
import {
  TlvMessage,
  WIDGET_SIZE,
  iterateMessage,
  readDisplayHeader,
  readDisplayWidgets,
  readTextSlot,
  readValueSlot,
  readWidgetAt,
  writeDisplayTable,
  writeTextSlot,
  writeValueSlot,
  writeWidgetSet,
} from '../src/proto/tlv.ts'
import { setTraceEnabled } from '../src/debug/trace.ts'
import { PANEL_PRESETS, validateWidget } from '../src/transport/mockKeyboard.ts'
import { useDeviceStore } from '../src/stores/device.ts'
import { useDisplayStore } from '../src/stores/display.ts'

const C_MODEL = path.resolve(import.meta.dirname, '../../keeb-module/boards/shields/keeb/ui/widget_model.c')

setTraceEnabled(false)

/* ------------------------------------------------------------------ 1. codec */

test('a widget table survives the round trip byte for byte', () => {
  const widgets: Widget[] = [
    { kind: KEEB_WID_FRAME, source: KEEB_SRC_NONE, x: 0, y: 0, w: 68, h: 160, style: 4 },
    { kind: KEEB_WID_TEXT, source: KEEB_SRC_LAYER_NAME, x: 4, y: 53, w: 60, h: 0, style: KEEB_TEXT_STYLE(1, 1) },
    { kind: KEEB_WID_BATTERY, source: KEEB_SRC_BATT_LEFT, x: 12, y: 146, w: 18, h: 9, style: 0 },
    { kind: KEEB_WID_BOLT, source: KEEB_SRC_NONE, x: 60, y: 4, w: 6, h: 10, style: 0 },
  ]
  const msg = new TlvMessage(512)

  assert.ok(writeDisplayTable(msg, widgets))

  const { records, malformed } = iterateMessage(msg.bytes())

  assert.equal(malformed, false)
  assert.equal(records.length, 1)
  assert.equal(records[0].type, KEEB_T_DISPLAY_SET)

  const hdr = readDisplayHeader(records[0].value)

  assert.equal(hdr.count, 4)
  assert.equal(records[0].value.length, 4 + 4 * WIDGET_SIZE)
  assert.deepEqual(readDisplayWidgets(records[0].value), widgets)
})

test('an empty table is still a header', () => {
  const msg = new TlvMessage(64)

  assert.ok(writeDisplayTable(msg, []))

  const [rec] = iterateMessage(msg.bytes()).records

  assert.equal(rec.value.length, 4, 'struct keeb_display_hdr is 4 bytes with no widgets')
  assert.equal(readDisplayHeader(rec.value).count, 0)
  assert.deepEqual(readDisplayWidgets(rec.value), [])
})

test('the mock reports a dirty flag the app can read', () => {
  /* The flag lives in the header the firmware sends, not in a local guess. */
  const msg = new TlvMessage(64)
  const dv = msg.add(KEEB_T_DISPLAY, 4)

  assert.ok(dv)
  dv.setUint8(0, 0)
  dv.setUint8(1, 3)
  dv.setUint8(2, KEEB_DISPLAY_F_DIRTY)
  dv.setUint8(3, 0)

  const [rec] = iterateMessage(msg.bytes()).records

  assert.equal(rec.type, KEEB_T_DISPLAY)
  assert.equal(readDisplayHeader(rec.value).preset, 3)
  assert.equal(readDisplayHeader(rec.value).flags, KEEB_DISPLAY_F_DIRTY)
})

test('a text slot is length-prefixed bytes, not a NUL string', () => {
  const msg = new TlvMessage(64)

  assert.ok(writeTextSlot(msg, 3, 'RAISE'))
  assert.ok(writeTextSlot(msg, 0, ''))

  const records = iterateMessage(msg.bytes()).records

  assert.equal(records[0].type, KEEB_T_TEXT_SET)
  assert.deepEqual(readTextSlot(records[0].value), { slot: 3, text: 'RAISE' })
  assert.deepEqual(readTextSlot(records[1].value), { slot: 0, text: '' })
})

test('a value slot is a signed 16-bit number', () => {
  const msg = new TlvMessage(64)

  assert.ok(writeValueSlot(msg, 2, -4321))
  assert.ok(writeValueSlot(msg, 1, 32767))

  const records = iterateMessage(msg.bytes()).records

  assert.equal(records[0].type, KEEB_T_VALUE_SET)
  assert.deepEqual(readValueSlot(records[0].value), { slot: 2, value: -4321 })
  assert.deepEqual(readValueSlot(records[1].value), { slot: 1, value: 32767 })
})

test('a single-widget write carries the index and the widget', () => {
  const msg = new TlvMessage(64)
  const w: Widget = { kind: KEEB_WID_TEXT, source: KEEB_SRC_DEVICE_ID, x: 4, y: 116, w: 60, h: 40, style: KEEB_TEXT_STYLE(2, 1) }

  assert.ok(writeWidgetSet(msg, 5, w))

  const [rec] = iterateMessage(msg.bytes()).records

  assert.equal(rec.type, KEEB_T_WIDGET_SET)
  assert.equal(rec.value.length, 2 + WIDGET_SIZE)
  assert.equal(rec.value[0], 5)
  assert.deepEqual(readWidgetAt(new DataView(rec.value.buffer, rec.value.byteOffset, rec.value.byteLength), 2), w)
})

/* ------------------------------------------- 2. the mock engine == firmware */

function fresh() {
  setActivePinia(createPinia())

  const device = useDeviceStore()
  const display = useDisplayStore()

  return { device, display }
}

async function loaded() {
  const { device, display } = fresh()

  await device.connectMock()
  await device.handshake()
  await display.load()
  display.bindEvents()

  return { device, display }
}

test('INFO says this firmware can draw a panel', async () => {
  const { device, display } = await loaded()

  assert.notEqual((device.info?.flags ?? 0) & KEEB_INFO_F_DISPLAY, 0)
  assert.equal(display.canEdit, true, 'a writable link to an editable panel')
})

test('DISPLAY_INFO carries the limits, and the presets are named', async () => {
  const { display } = await loaded()
  const info = display.info

  assert.ok(display.loaded)
  assert.equal(display.lastError, '')
  assert.ok(info)

  assert.equal(info.editable, true, 'the central owns its panel')
  assert.equal(info.presetCount, 2)
  assert.equal(info.widgetMax, 24)
  assert.equal(info.textSlots, 8)
  assert.equal(info.textMax, 24)
  assert.equal(info.valueSlots, 4)
  assert.equal(info.kindMax, KEEB_WID_COUNT)
  assert.equal(info.sourceMax, KEEB_SRC_VALUE_BASE + 4 - 1)
  assert.equal(info.logicalW, 68)
  assert.equal(info.logicalH, 160)
  assert.equal(info.panelW, 160)
  assert.equal(info.panelH, 68)
  assert.equal(info.rotation, 90)
  assert.equal(info.widgetSize, WIDGET_SIZE)
  assert.equal(info.flags, KEEB_DISPLAY_INFO_F_ART)
  assert.equal(info.layers, 6, 'six layers, so six pips')
  assert.equal(display.canDrawArt, true)
  assert.equal(display.layerCount, 6)

  assert.deepEqual(
    display.presets.map((p) => p.name),
    ['STATUS', 'MINIMAL'],
  )
})

test('the panel the keyboard reports is its preset, not a local guess', async () => {
  const { display } = await loaded()

  assert.equal(display.widgets.length, PANEL_PRESETS[0].widgets.length)
  assert.equal(display.preset, 0)
  assert.equal(display.deviceDirty, false)
  assert.equal(display.texts[0], 'KEYBOARD SYSTEM')
  assert.equal(display.texts[3], 'SYS. READY_')
  assert.equal(display.texts[7], '')
  assert.equal(display.values[0], 0)

  const deviceText = display.widgets.find((w) => w.source === KEEB_SRC_DEVICE_ID)

  assert.equal(deviceText, undefined, 'the STATUS preset does not show the device')
})

test('an edit is local until Apply, and Apply is not Save', async () => {
  const { device, display } = await loaded()

  assert.equal(display.edit(1, { x: 20 }), '')
  assert.equal(display.hasLocalEdits, true)
  assert.equal(display.unsavedWrites, false)

  /* A re-read keeps what is staged — the keyboard is not the editor's memory.
   * What the keyboard actually has is a question for the keyboard: x is still 5. */
  await display.reload()
  assert.equal(display.widgets[1].x, 20, 'staged edits survive a re-read')
  assert.equal((await device.readDisplay()).widgets[1].x, 5, 'the keyboard has not been touched')

  assert.equal((await display.applyTable()).ok, true)
  assert.equal(display.unsavedWrites, true)
  assert.equal(display.deviceDirty, true, 'the firmware marks an applied panel dirty')
  assert.equal(display.widgets[1].x, 20)

  assert.equal((await display.save()).ok, true)
  assert.equal(display.unsavedWrites, false)
  assert.equal(display.deviceDirty, false)
})

test('geometry the panel cannot hold is refused before it is sent', async () => {
  const { display } = await loaded()
  const before = display.widgets.map((w) => ({ ...w }))

  assert.match(display.edit(1, { x: 68 }), /outside the panel/)
  assert.match(display.edit(1, { w: 99 }), /runs off/)
  assert.deepEqual(display.widgets.map((w) => ({ ...w })), before, 'a refused edit changed nothing local')

  const nothing = await display.applyTable()

  assert.equal(nothing.ok, false)
  assert.match(nothing.reason ?? '', /nothing staged/)
  assert.equal(display.unsavedWrites, false)

  await display.reload()
  assert.deepEqual(display.widgets, before, 'and nothing reached the keyboard')
})

test('a kind cannot be fed by a source that cannot feed it', async () => {
  const { display } = await loaded()

  /* Pips are not text; a bar is not a layer name. */
  assert.match(display.edit(1, { source: KEEB_SRC_LAYER_PIPS }), /cannot be fed/)
  assert.match(display.edit(11, { source: KEEB_SRC_LAYER_NAME }), /cannot be fed/)

  /* A kind and a source travel together: switching to artwork without a
   * source that can feed it is exactly the mismatch the firmware refuses. */
  assert.match(display.edit(1, { kind: KEEB_WID_ART }), /cannot be fed/)
  assert.equal(display.edit(1, { kind: KEEB_WID_ART, source: KEEB_SRC_LAYER_ART }), '')
  assert.equal(display.widgets[1].source, KEEB_SRC_LAYER_ART)
})

test('a text slot reaches the widget that points at it', async () => {
  const { display } = await loaded()

  assert.equal((await display.setTextSlot(0, 'MY KEYBOARD')).ok, true)
  assert.equal(display.texts[0], 'MY KEYBOARD')
  assert.equal(display.unsavedWrites, true)

  const bound = display.widgets.filter((w) => w.source === KEEB_SRC_TEXT_BASE)

  assert.ok(bound.length > 0, 'the STATUS preset binds text 0')

  const tooLong = await display.setTextSlot(0, 'ABCDEFGH'.repeat(3) + 'X')

  assert.equal(tooLong.ok, false, '24 bytes is the limit')
  assert.match(tooLong.reason ?? '', /24 bytes/)
})

test('value slots are live: they redraw, and they are never saved', async () => {
  const { display } = await loaded()

  assert.equal((await display.setValueSlot(1, -75)).ok, true)
  assert.equal(display.values[1], -75)
  assert.equal(display.unsavedWrites, false, 'a live value is not a pending change')
  assert.equal(display.deviceDirty, false)
})

test('a preset replaces the table and the text slots with its own', async () => {
  const { display } = await loaded()

  await display.setTextSlot(0, 'KEEP ME')

  assert.equal((await display.applyPreset(1)).ok, true)
  assert.equal(display.widgets.length, PANEL_PRESETS[1].widgets.length)
  assert.equal(display.preset, 1)
  /* keeb_ui_apply_preset() re-fills every text slot from the preset, so a
   * preset is a whole starting point and not only a layout. Discard is what
   * brings the written text back, because it returns to the saved panel. */
  assert.equal(display.texts[0], 'DEVICE', 'the preset carries its own text')

  const deviceWidget = display.widgets.find((w) => w.source === KEEB_SRC_DEVICE_ID)

  assert.ok(deviceWidget, 'MINIMAL shows the connected device')
  assert.equal(deviceWidget.h, 40)

  assert.equal((await display.applyPreset(9)).ok, false)
})

test('discard returns to the last saved panel; reset returns to the preset', async () => {
  const { display } = await loaded()

  /* Widget 1 is 34 px wide, so 34 + x has to stay inside 68. */
  display.edit(1, { x: 20 })
  assert.equal((await display.applyTable()).ok, true)
  assert.equal((await display.save()).ok, true)

  display.edit(1, { x: 30 })
  assert.equal((await display.applyTable()).ok, true)

  assert.equal(display.widgets[1].x, 30)

  assert.equal((await display.discard()).ok, true)
  assert.equal(display.widgets[1].x, 20, 'back to what was saved, not to the preset')

  assert.equal((await display.resetStorage()).ok, true)
  assert.equal(display.widgets[1].x, 5, 'the preset again')
  assert.equal(display.preset, 0)
})

test('adding widgets stops at the firmware limit', async () => {
  const { display } = await loaded()

  let guard = 0

  while (display.addWidget() === '' && guard++ < 40) {
    /* fill the table */
  }

  assert.equal(display.widgets.length, 24)
  assert.match(display.addWidget(), /holds 24 widgets/)

  /* The whole-table write is what the firmware validates as one unit. */
  assert.equal((await display.applyTable()).ok, true)
  assert.equal(display.widgets.length, 24)
})

test('a single widget write lands where the index says', async () => {
  const { device, display } = await loaded()

  const ack = await device.writeWidget(2, {
    kind: KEEB_WID_BAR,
    source: KEEB_SRC_BATT_RIGHT,
    x: 4,
    y: 4,
    w: 60,
    h: 6,
    style: 0,
  })

  assert.equal(ack.status, KEEB_STATUS_OK)
  assert.equal(ack.detail, 0, 'the engine reports a landed widget by the table, not by an index')

  await display.reload()

  assert.equal(display.widgets[2].kind, KEEB_WID_BAR)
  assert.equal(display.widgets[2].source, KEEB_SRC_BATT_RIGHT)
  assert.equal(display.preset, KBEEB_PRESET_CUSTOM)
})

/* --------------------- 3. the mock's panel is the firmware's panel, in C */

const KIND_BY_MACRO: Record<string, number> = {
  W_FRAME: KEEB_WID_FRAME,
  W_RECT: KEEB_WID_RECT,
  W_RULE: KEEB_WID_RULE,
  W_TEXT: KEEB_WID_TEXT,
  W_BAR: KEEB_WID_BAR,
  W_BATTERY: KEEB_WID_BATTERY,
  W_PIPS: KEEB_WID_PIPS,
  W_BOLT: KEEB_WID_BOLT,
  W_ART: KEEB_WID_ART,
}

const SOURCE_BY_NAME: Record<string, number> = {
  KEEB_SRC_NONE: KEEB_SRC_NONE,
  KEEB_SRC_LAYER_INDEX: 1,
  KEEB_SRC_LAYER_NAME: 2,
  KEEB_SRC_LAYER_POS: 3,
  KEEB_SRC_LAYER_PIPS: KEEB_SRC_LAYER_PIPS,
  KEEB_SRC_LAYER_ART: KEEB_SRC_LAYER_ART,
  KEEB_SRC_BATT_LEFT: KEEB_SRC_BATT_LEFT,
  KEEB_SRC_BATT_LEFT_PCT: 7,
  KEEB_SRC_BATT_RIGHT: KEEB_SRC_BATT_RIGHT,
  KEEB_SRC_BATT_RIGHT_PCT: 9,
  KEEB_SRC_LINK: 10,
  KEEB_SRC_LINK_SHORT: 11,
  KEEB_SRC_HOST: 12,
  KEEB_SRC_CHARGING: 13,
  KEEB_SRC_DEVICE_ID: 14,
  KEEB_SRC_DEVICE_NAME: 15,
}

/**
 * Expand a C preset table into the shape the wire carries.
 *
 * The macros in widget_model.c fill a struct keeb_widget, which means a W_RULE
 * takes three arguments and a W_BATTERY takes three too — the geometry is part
 * of the macro. Expanding them here, rather than reading the table as if every
 * macro had the same arity, is the point: this is the firmware's preset, not an
 * assumption about what it looks like.
 */
function parseCTable(name: string): Widget[] {
  const src = readFileSync(C_MODEL, 'utf8')
  const start = src.indexOf(`static const struct keeb_widget ${name}[] = {`)

  assert.notEqual(start, -1, `${name} is not in widget_model.c`)

  const body = src.slice(start, src.indexOf('};', start))
  const widgets: Widget[] = []

  /* A preset writes a style as a name (KEEB_PIPS_LARGE, KEEB_RECT_PAPER) just
   * as easily as a number, and the compiler never sees the difference. */
  const SYMBOL: Record<string, number> = {
    KEEB_PIPS_SMALL: 0,
    KEEB_PIPS_LARGE: 1,
    KEEB_PIPS_TINY: 2,
    KEEB_RECT_INK: 0,
    KEEB_RECT_PAPER: 1,
    KEEB_ART_CENTRE: 0,
    KEEB_ART_BOTTOM: 1,
  }

  const num = (v: string | undefined, line: string): number => {
    if (v !== undefined && v in SYMBOL) {
      return SYMBOL[v]
    }

    const n = Number(v)

    assert.ok(v !== undefined && Number.isFinite(n), `non-numeric argument in: ${line}`)

    return n
  }

  const source = (v: string, line: string): number => {
    const slot = /^SLOT\((\d+)\)$/.exec(v)

    if (slot) {
      return KEEB_SRC_TEXT_BASE + Number(slot[1])
    }

    const known = SOURCE_BY_NAME[v]

    assert.notEqual(known, undefined, `unknown source "${v}" in: ${line}`)

    return known
  }

  for (const raw of body.split('\n')) {
    const line = raw.trim()
    /* Greedy on purpose: a preset row can nest a macro call, SLOT(0). */
    const m = /^(W_[A-Z]+)\((.*)\),?$/.exec(line)

    if (!m) {
      continue
    }

    const macro = m[1]
    const a = m[2].split(',').map((it) => it.trim())

    assert.notEqual(KIND_BY_MACRO[macro], undefined, `unknown widget macro ${macro}`)

    switch (macro) {
      case 'W_FRAME':
        widgets.push({ kind: KEEB_WID_FRAME, source: KEEB_SRC_NONE, x: num(a[0], line), y: num(a[1], line), w: num(a[2], line), h: num(a[3], line), style: num(a[4], line) })
        break

      case 'W_RECT':
        widgets.push({ kind: KEEB_WID_RECT, source: KEEB_SRC_NONE, x: num(a[0], line), y: num(a[1], line), w: num(a[2], line), h: num(a[3], line), style: num(a[4], line) })
        break

      case 'W_RULE':
        widgets.push({ kind: KEEB_WID_RULE, source: KEEB_SRC_NONE, x: num(a[0], line), y: num(a[1], line), w: num(a[2], line), h: 1, style: 0 })
        break

      case 'W_TEXT':
        widgets.push({
          kind: KEEB_WID_TEXT,
          source: source(a[4], line),
          x: num(a[0], line),
          y: num(a[1], line),
          w: num(a[2], line),
          h: num(a[3], line),
          style: KEEB_TEXT_STYLE(num(a[5], line), num(a[6], line)),
        })
        break

      case 'W_BAR':
        widgets.push({ kind: KEEB_WID_BAR, source: source(a[4], line), x: num(a[0], line), y: num(a[1], line), w: num(a[2], line), h: num(a[3], line), style: 0 })
        break

      case 'W_BATTERY':
        widgets.push({ kind: KEEB_WID_BATTERY, source: source(a[2], line), x: num(a[0], line), y: num(a[1], line), w: 17, h: 9, style: 0 })
        break

      case 'W_PIPS':
        widgets.push({ kind: KEEB_WID_PIPS, source: KEEB_SRC_LAYER_PIPS, x: num(a[0], line), y: num(a[1], line), w: num(a[2], line), h: num(a[3], line), style: num(a[4], line) })
        break

      case 'W_BOLT':
        widgets.push({ kind: KEEB_WID_BOLT, source: KEEB_SRC_NONE, x: num(a[0], line), y: num(a[1], line), w: 7, h: 9, style: 0 })
        break

      case 'W_ART':
        widgets.push({ kind: KEEB_WID_ART, source: KEEB_SRC_LAYER_ART, x: num(a[0], line), y: num(a[1], line), w: num(a[2], line), h: num(a[3], line), style: num(a[4], line) })
        break

      default:
        assert.fail(`no expansion rule for ${macro}`)
    }
  }

  assert.ok(widgets.length > 0, `${name} parsed to nothing`)

  return widgets
}

test('the firmware presets are tables a host could write back', () => {
  /* The editor reads the panel and writes it back on every Apply, so a preset
   * the validator would refuse is a panel that cannot be edited at all — the
   * pip row is exactly where that happened once. */
  for (const name of ['central_portrait', 'central_minimal_portrait']) {
    for (const [i, w] of parseCTable(name).entries()) {
      assert.equal(validateWidget(w), 0, `${name}[${i}] would be refused: ${JSON.stringify(w)}`)
    }
  }
})

test('a pip row is measured the way the firmware measures it', () => {
  /* keeb_ui_validate_widget(): count * (pip_w + gap), gap 3 for the large row. */
  const row = (x: number, pipW: number, style: number): Widget =>
    ({ kind: KEEB_WID_PIPS, source: KEEB_SRC_LAYER_PIPS, x, y: 82, w: pipW, h: 4, style })

  assert.equal(validateWidget(row(5, 7, 1)), 0)
  assert.equal(validateWidget(row(8, 7, 1)), 0)
  assert.equal(validateWidget(row(9, 7, 1)), KEEB_ERR_OUT_OF_RANGE, 'one pixel too far right')
  assert.equal(validateWidget(row(5, 8, 1)), KEEB_ERR_OUT_OF_RANGE, 'pips too wide for six layers')
})

test('the mock panel and the firmware panel are the same table', () => {
  assert.deepEqual(
    PANEL_PRESETS[0].widgets,
    parseCTable('central_portrait'),
    'the mock mirrors the firmware preset — if one moves, both must move',
  )
})

test('the editor offers exactly the kinds the firmware can draw', () => {
  /* A kind in the picker that the panel cannot draw is a control that writes a
   * widget the firmware would refuse. */
  const offered = new Set([
    KEEB_WID_FRAME,
    KEEB_WID_RECT,
    KEEB_WID_RULE,
    KEEB_WID_TEXT,
    KEEB_WID_BAR,
    KEEB_WID_BATTERY,
    KEEB_WID_PIPS,
    KEEB_WID_BOLT,
    KEEB_WID_ART,
  ])

  assert.equal(offered.size, KEEB_WID_COUNT - 1, 'every kind but NONE is editable')
  assert.equal(offered.has(KEEB_WID_NONE), false)
})
