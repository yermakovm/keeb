/*
 * Wire layout parity.
 *
 * The firmware guarantees its side of the wire with _Static_assert on every
 * packed struct, and app/scripts/gen-contract.mjs re-derives the same sizes
 * from the field lists (it refuses to write protocol.gen.ts when they
 * disagree). What neither of those checks is the last hop: the readers in
 * src/proto/tlv.ts, which pull fields out of a buffer with hardcoded offsets.
 *
 * So each reader here is fed a payload built from the generated layout — field
 * widths in declaration order, values written at the generated offsets — and
 * every field the header declares has to come back through the reader under
 * the name the app uses. Move a field in the header, re-run npm run gen, and
 * this file fails with the field name that moved.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  KEEB_ACK_FIELDS,
  KEEB_ACK_OFFSETS,
  KEEB_ACK_SIZE,
  KEEB_CELL_FIELDS,
  KEEB_CELL_OFFSETS,
  KEEB_CELL_SIZE,
  KEEB_CELLS_HDR_FIELDS,
  KEEB_CELLS_HDR_OFFSETS,
  KEEB_CELLS_HDR_SIZE,
  KEEB_DISPLAY_HDR_FIELDS,
  KEEB_DISPLAY_HDR_OFFSETS,
  KEEB_DISPLAY_HDR_SIZE,
  KEEB_DISPLAY_INFO_FIELDS,
  KEEB_DISPLAY_INFO_OFFSETS,
  KEEB_DISPLAY_INFO_SIZE,
  KEEB_INFO_FIELDS,
  KEEB_INFO_OFFSETS,
  KEEB_INFO_SIZE,
  KEEB_LAYERS_HDR_FIELDS,
  KEEB_LAYERS_HDR_OFFSETS,
  KEEB_LAYERS_HDR_SIZE,
  KEEB_NOTIFY_FIELDS,
  KEEB_NOTIFY_OFFSETS,
  KEEB_NOTIFY_SIZE,
  KEEB_PARAM_VALUE_FIELDS,
  KEEB_PARAM_VALUE_OFFSETS,
  KEEB_PARAM_VALUE_SIZE,
  KEEB_PRESET_NAME_FIELDS,
  KEEB_PRESET_NAME_OFFSETS,
  KEEB_PRESET_NAME_SIZE,
  KEEB_TEXT_SLOT_FIELDS,
  KEEB_TEXT_SLOT_OFFSETS,
  KEEB_TEXT_SLOT_SIZE,
  KEEB_TOKEN_PARAMS_HDR_FIELDS,
  KEEB_TOKEN_PARAMS_HDR_OFFSETS,
  KEEB_TOKEN_PARAMS_HDR_SIZE,
  KEEB_TOKEN_REC_FIELDS,
  KEEB_TOKEN_REC_OFFSETS,
  KEEB_TOKEN_REC_SIZE,
  KEEB_TOKENS_HDR_FIELDS,
  KEEB_TOKENS_HDR_OFFSETS,
  KEEB_TOKENS_HDR_SIZE,
  KEEB_VALUE_SLOT_FIELDS,
  KEEB_VALUE_SLOT_OFFSETS,
  KEEB_VALUE_SLOT_SIZE,
  KEEB_WIDGET_FIELDS,
  KEEB_WIDGET_OFFSETS,
  KEEB_WIDGET_SIZE,
} from '../src/proto/constants.ts'
import {
  readAck,
  readCells,
  readDisplayHeader,
  readDisplayInfo,
  readInfo,
  readLayers,
  readNotify,
  readParamValue,
  readPresetName,
  readTextSlot,
  readTokenRec,
  readTokensHeader,
  readValueSlot,
  readWidgetAt,
} from '../src/proto/tlv.ts'

interface Layout {
  name: string
  fields: number[]
  offsets: Record<string, number>
  size: number
}

const LAYOUTS: Layout[] = [
  { name: 'keeb_info', fields: KEEB_INFO_FIELDS, offsets: KEEB_INFO_OFFSETS, size: KEEB_INFO_SIZE },
  { name: 'keeb_ack', fields: KEEB_ACK_FIELDS, offsets: KEEB_ACK_OFFSETS, size: KEEB_ACK_SIZE },
  { name: 'keeb_notify', fields: KEEB_NOTIFY_FIELDS, offsets: KEEB_NOTIFY_OFFSETS, size: KEEB_NOTIFY_SIZE },
  { name: 'keeb_cell', fields: KEEB_CELL_FIELDS, offsets: KEEB_CELL_OFFSETS, size: KEEB_CELL_SIZE },
  { name: 'keeb_cells_hdr', fields: KEEB_CELLS_HDR_FIELDS, offsets: KEEB_CELLS_HDR_OFFSETS, size: KEEB_CELLS_HDR_SIZE },
  { name: 'keeb_layers_hdr', fields: KEEB_LAYERS_HDR_FIELDS, offsets: KEEB_LAYERS_HDR_OFFSETS, size: KEEB_LAYERS_HDR_SIZE },
  { name: 'keeb_tokens_hdr', fields: KEEB_TOKENS_HDR_FIELDS, offsets: KEEB_TOKENS_HDR_OFFSETS, size: KEEB_TOKENS_HDR_SIZE },
  { name: 'keeb_token_rec', fields: KEEB_TOKEN_REC_FIELDS, offsets: KEEB_TOKEN_REC_OFFSETS, size: KEEB_TOKEN_REC_SIZE },
  { name: 'keeb_token_params_hdr', fields: KEEB_TOKEN_PARAMS_HDR_FIELDS, offsets: KEEB_TOKEN_PARAMS_HDR_OFFSETS, size: KEEB_TOKEN_PARAMS_HDR_SIZE },
  { name: 'keeb_param_value', fields: KEEB_PARAM_VALUE_FIELDS, offsets: KEEB_PARAM_VALUE_OFFSETS, size: KEEB_PARAM_VALUE_SIZE },
  { name: 'keeb_display_info', fields: KEEB_DISPLAY_INFO_FIELDS, offsets: KEEB_DISPLAY_INFO_OFFSETS, size: KEEB_DISPLAY_INFO_SIZE },
  { name: 'keeb_display_hdr', fields: KEEB_DISPLAY_HDR_FIELDS, offsets: KEEB_DISPLAY_HDR_OFFSETS, size: KEEB_DISPLAY_HDR_SIZE },
  { name: 'keeb_widget', fields: KEEB_WIDGET_FIELDS, offsets: KEEB_WIDGET_OFFSETS, size: KEEB_WIDGET_SIZE },
  { name: 'keeb_text_slot', fields: KEEB_TEXT_SLOT_FIELDS, offsets: KEEB_TEXT_SLOT_OFFSETS, size: KEEB_TEXT_SLOT_SIZE },
  { name: 'keeb_value_slot', fields: KEEB_VALUE_SLOT_FIELDS, offsets: KEEB_VALUE_SLOT_OFFSETS, size: KEEB_VALUE_SLOT_SIZE },
  { name: 'keeb_preset_name', fields: KEEB_PRESET_NAME_FIELDS, offsets: KEEB_PRESET_NAME_OFFSETS, size: KEEB_PRESET_NAME_SIZE },
]

/** Look a layout up by the C struct name, so a test says which struct it means. */
function layout(name: string): Layout {
  const found = LAYOUTS.find((l) => l.name === name)

  assert.ok(found, `no generated layout for struct ${name} — protocol.gen.ts does not describe it`)

  return found
}

/** Field order, name, offset and width — straight off the generated tables. */
function fieldList(layout: Layout) {
  const names = Object.keys(layout.offsets)

  assert.equal(names.length, layout.fields.length, `${layout.name}: ${names.length} offsets for ${layout.fields.length} widths`)

  let expect = 0
  const out = []

  for (let i = 0; i < names.length; i++) {
    const width = layout.fields[i]

    assert.equal(
      layout.offsets[names[i]],
      expect,
      `${layout.name}.${names[i]} sits at ${layout.offsets[names[i]]}, but the field before it ends at ${expect}`,
    )

    out.push({ name: names[i], width, offset: expect })
    expect += width
  }

  assert.equal(expect, layout.size, `${layout.name}: the fields add up to ${expect} but the header asserts ${layout.size}`)

  return out
}

for (const layout of LAYOUTS) {
  test(`${layout.name}: the generated offsets are contiguous and add up to the asserted size`, () => {
    fieldList(layout)
  })
}

/** A payload with each field written at its generated offset. */
function writeRecord(layout: Layout, values: Record<string, number>, tail = new Uint8Array()): Uint8Array {
  const buf = new Uint8Array(layout.size + tail.length)
  const dv = new DataView(buf.buffer)

  for (const f of fieldList(layout)) {
    const v = values[f.name] ?? 0

    if (f.width === 1) dv.setUint8(f.offset, v)
    else if (f.width === 2) dv.setUint16(f.offset, v, true)
    else dv.setUint32(f.offset, v, true)
  }

  buf.set(tail, layout.size)

  return buf
}

/** Every field the header declares has to arrive through the reader — except the
 * ones the reader consumes instead of returning: padding, and a length that
 * becomes the byte count of a string that follows the record. Skip them on
 * purpose, by name, so the list is auditable. */
interface FieldChecks {
  rename?: Record<string, string>
  consumed?: string[]
  /** Fields the reader converts rather than copies — a byte that becomes a
   * boolean — with the value the conversion has to produce. */
  expect?: Record<string, unknown>
}

function assertFields(layout: Layout, values: Record<string, number>, readerResult: object, checks: FieldChecks = {}) {
  const got = readerResult as unknown as Record<string, unknown>
  const rename = checks.rename ?? {}
  const consumed = new Set(checks.consumed ?? [])

  for (const f of fieldList(layout)) {
    const key = rename[f.name] ?? f.name

    if (consumed.has(f.name)) {
      continue
    }

    assert.ok(
      key in got,
      `readers never return ${layout.name}.${f.name} (${key}) — a field the firmware sends is being dropped`,
    )
    const want = f.name in (checks.expect ?? {}) ? checks.expect![f.name] : (values[f.name] ?? 0)

    assert.equal(got[key], want, `${layout.name}.${f.name} read from the wrong offset`)
  }
}

test('readInfo reads struct keeb_info where the header puts it', () => {
  const values = {
    proto: 1,
    fw_version: 0x0102,
    layer_count: 6,
    key_count: 60,
    name_max: 16,
    token_count: 28,
    token_hash: 0x5f56a415,
    flags: 0x0000000f,
  }

  assertFields(
    layout('keeb_info'),
    values,
    readInfo(writeRecord(layout('keeb_info'), values)),
    {
      rename: {
        fw_version: 'fwVersion',
        layer_count: 'layerCount',
        key_count: 'keyCount',
        name_max: 'nameMax',
        token_count: 'tokenCount',
        token_hash: 'tokenHash',
      },
    },
  )
})

test('readAck reads struct keeb_ack', () => {
  const values = { msg_id: 0xbeef, status: 1, err_code: 16, detail: 7, extra: 0x12345678 }

  assertFields(
    layout('keeb_ack'),
    values,
    readAck(writeRecord(layout('keeb_ack'), values)),
    { rename: { msg_id: 'msgId', err_code: 'errCode' } },
  )
})

test('readNotify reads struct keeb_notify and hands back the payload after it', () => {
  const values = { event: 6, seq: 3 }
  const tail = new Uint8Array([0xaa, 0xbb, 0xcc])
  const got = readNotify(writeRecord(layout('keeb_notify'), values, tail))

  assertFields(layout('keeb_notify'), values, got)
  assert.deepEqual(Array.from(got.data), Array.from(tail), 'the notification body starts at the wrong byte')
})

test('readCells reads struct keeb_cells_hdr and each struct keeb_cell', () => {
  const hdr = layout('keeb_cells_hdr')
  const cell = layout('keeb_cell')
  const cells = [
    { layer: 0, flags: 0, pos: 0, token: 1, rsvd: 0, param1: 0x11111111, param2: 0x22222222 },
    { layer: 0, flags: 1, pos: 11, token: 0xffff, rsvd: 0, param1: 0, param2: 0xdeadbeef },
  ]

  const buf = new Uint8Array(KEEB_CELLS_HDR_SIZE + cells.length * KEEB_CELL_SIZE)
  const dv = new DataView(buf.buffer)

  for (const f of fieldList(hdr)) {
    const v = ({ layer: 2, flags: 0, count: cells.length } as Record<string, number>)[f.name] ?? 0

    if (f.width === 1) dv.setUint8(f.offset, v)
    else if (f.width === 2) dv.setUint16(f.offset, v, true)
    else dv.setUint32(f.offset, v, true)
  }

  cells.forEach((values, i) => {
    for (const f of fieldList(cell)) {
      const off = KEEB_CELLS_HDR_SIZE + i * KEEB_CELL_SIZE + f.offset
      const v = values[f.name as keyof typeof values]

      if (f.width === 1) dv.setUint8(off, v)
      else if (f.width === 2) dv.setUint16(off, v, true)
      else dv.setUint32(off, v, true)
    }
  })

  const got = readCells(buf)

  assert.equal(got.layer, 2, 'cells header: layer read from the wrong offset')
  assert.equal(got.flags, 0, 'cells header: flags read from the wrong offset')
  assert.equal(got.cells.length, cells.length, 'cells header: count read from the wrong offset')

  cells.forEach((values, i) => {
    assertFields(cell, values, got.cells[i], { rename: { rsvd: 'reserved' } })
  })
})

test('readLayers reads struct keeb_layers_hdr, then the order bytes after it', () => {
  const layersHdr = layout('keeb_layers_hdr')
  const values = { count: 6, active: 5, state: 0b100001, locked: 0, rsvd: 0, name_max: 16 }
  const order = new Uint8Array([0, 1, 2, 3, 4, 5])
  const got = readLayers(writeRecord(layersHdr, values, order))

  assertFields(layersHdr, values, got, {
    rename: { name_max: 'nameMax' },
    consumed: ['rsvd'],
  })
  assert.deepEqual(got.order, Array.from(order), 'the layer order table starts at the wrong byte')
})

test('readTokensHeader and readTokenRec read the token table records', () => {
  const hdr = layout('keeb_tokens_hdr')
  const values = { next: 0xffff, count: 28, token_hash: 0x5f56a415 }

  assertFields(hdr, values, readTokensHeader(writeRecord(hdr, values)), {
    rename: { token_hash: 'tokenHash' },
  })

  const rec = layout('keeb_token_rec')
  const name = new TextEncoder().encode('hold_key')
  const recValues = { token: 7, rsvd: 0, name_len: name.length, flags: 1 }
  const got = readTokenRec(writeRecord(rec, recValues, name))

  assert.equal(got.token, 7)
  assert.equal(got.flags, 1)
  assert.equal(got.name, 'hold_key', 'the token name starts at the wrong byte')
})

test('readParamValue reads struct keeb_param_value', () => {
  const paramValue = layout('keeb_param_value')
  const name = new TextEncoder().encode('hold-tap')
  const values = { token: 12, param: 2, type: 4, a: 0x11111111, b: 0, name_len: name.length, set: 1 }
  const got = readParamValue(writeRecord(paramValue, values, name))

  assertFields(paramValue, values, got, { consumed: ['name_len'] })
  assert.equal(got.name, 'hold-tap', 'the parameter name starts at the wrong byte')
})

test('readDisplayInfo reads struct keeb_display_info', () => {
  const displayInfo = layout('keeb_display_info')
  const values = {
    editable: 1,
    preset_count: 4,
    widget_max: 24,
    text_slots: 6,
    text_max: 32,
    value_slots: 4,
    kind_max: 10,
    source_max: 24,
    logical_w: 128,
    logical_h: 64,
    panel_w: 128,
    panel_h: 64,
    rotation: 90,
    widget_size: KEEB_WIDGET_SIZE,
    flags: 1,
    layers: 6,
  }

  assertFields(
    displayInfo,
    values,
    readDisplayInfo(writeRecord(displayInfo, values)),
    { rename: {
      preset_count: 'presetCount',
      widget_max: 'widgetMax',
      text_slots: 'textSlots',
      text_max: 'textMax',
      value_slots: 'valueSlots',
      kind_max: 'kindMax',
      source_max: 'sourceMax',
      logical_w: 'logicalW',
      logical_h: 'logicalH',
      panel_w: 'panelW',
      panel_h: 'panelH',
      widget_size: 'widgetSize',
    },
    expect: { editable: true },
  })
})

test('readDisplayHeader reads struct keeb_display_hdr and readWidgetAt reads struct keeb_widget', () => {
  const hdr = layout('keeb_display_hdr')
  const values = { count: 12, preset: 2, flags: 3, rsvd: 0 }

  assertFields(hdr, values, readDisplayHeader(writeRecord(hdr, values)), {
    consumed: ['rsvd'],
  })

  const widget = layout('keeb_widget')
  const widgetValues = { kind: 4, source: 0x20, x: 1, y: 2, w: 30, h: 8, style: 0x0d }
  const buf = writeRecord(widget, widgetValues)
  const dv = new DataView(buf.buffer)

  assertFields(widget, widgetValues, readWidgetAt(dv, 0))

  /* The same widget one record later: readDisplayWidgets steps by the size the
   * header asserts, not by a literal. */
  const two = new Uint8Array(KEEB_WIDGET_SIZE * 2)

  two.set(buf, 0)
  two.set(writeRecord(widget, { ...widgetValues, kind: 6, x: 9 }), KEEB_WIDGET_SIZE)

  const second = readWidgetAt(new DataView(two.buffer), KEEB_WIDGET_SIZE)

  assert.equal(second.kind, 6)
  assert.equal(second.x, 9)
})

test('readTextSlot, readValueSlot and readPresetName read their records', () => {
  const text = layout('keeb_text_slot')
  const str = new TextEncoder().encode('LEFT')
  const textValues = { slot: 3, len: str.length }
  const gotText = readTextSlot(writeRecord(text, textValues, str))

  assert.equal(gotText.slot, 3)
  assert.equal(gotText.text, 'LEFT', 'the text starts at the wrong byte')

  const value = layout('keeb_value_slot')
  const valueValues = { slot: 1, rsvd: 0, value: 0x1234 }
  const gotValue = readValueSlot(writeRecord(value, valueValues))

  assert.equal(gotValue.slot, 1)
  assert.equal(gotValue.value, 0x1234, 'the value read from the wrong offset')

  const preset = layout('keeb_preset_name')
  const presetName = new TextEncoder().encode('Status')
  const gotPreset = readPresetName(writeRecord(preset, { preset: 2, name_len: presetName.length }, presetName))

  assert.equal(gotPreset.preset, 2)
  assert.equal(gotPreset.name, 'Status', 'the preset name starts at the wrong byte')
})
