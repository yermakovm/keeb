/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Payload types — the TypeScript face of the packed structs in
 * keeb-module/proto/keeb_tlv.h. Field names, field order and widths match the
 * C structs so a wire payload decodes into exactly what the firmware wrote.
 *
 * No TS enums here: the protocol's numbers are the C values, and `as const`
 * objects keep them comparable with the constants in ./constants.ts without
 * inventing a second type system.
 */

/** struct keeb_pkt_hdr — magic(2) version(1) flags(1) msg_id(2) frag_off(2)
 * frag_len(2) msg_len(2) crc(4) = 16 bytes, little-endian. */
export interface PktHdr {
  magic: number
  version: number
  flags: number
  msgId: number
  fragOff: number
  fragLen: number
  msgLen: number
  crc: number
}

/** struct keeb_tlv_rec — the record header; `value` is the payload after it. */
export interface TlvRecord {
  type: number
  len: number
  value: Uint8Array
}

/** struct keeb_info — what the firmware can do. */
export interface InfoPayload {
  proto: number
  fwVersion: number
  layerCount: number
  keyCount: number
  nameMax: number
  tokenCount: number
  tokenHash: number
  flags: number
}

/** struct keeb_ack — exactly one per processed message. */
export interface AckPayload {
  msgId: number
  status: number
  errCode: number
  /** per-op result, e.g. the new layer index */
  detail: number
  /** per-op result, e.g. the active layer bitmask */
  extra: number
}

/** struct keeb_notify header; the event payload follows it. */
export interface NotifyHeader {
  event: number
  seq: number
  data: Uint8Array
}

/** struct keeb_cell — one cell of a KEEB_T_CELLS dump. */
export interface CellPayload {
  layer: number
  flags: number
  /** stock position, not a matrix position */
  pos: number
  token: number
  reserved: number
  param1: number
  param2: number
}

/** struct keeb_cell_set — one requested binding. */
export interface CellSetPayload {
  pos: number
  flags: number
  token: number
  param1: number
  param2: number
}

/** struct keeb_layers_hdr plus order[count] layer ids. */
export interface LayersPayload {
  count: number
  /** highest active layer id, 0xffff when none */
  active: number
  state: number
  locked: number
  nameMax: number
  /** slot index -> layer id */
  order: number[]
  /** layer id -> name, from the trailing KEEB_T_LAYER_NAME_SET records */
  names: Record<number, string>
}

/** struct keeb_tokens_hdr. */
export interface TokensHeader {
  /** index to continue from, 0xffff when complete */
  next: number
  count: number
  tokenHash: number
}

/** struct keeb_token_rec plus its name bytes. */
export interface TokenRecord {
  token: number
  name: string
  flags: number
}

/** struct keeb_param_value plus its display name. */
export interface ParamValue {
  token: number
  /** 0 = param1, 1 = param2 */
  param: number
  type: number
  a: number
  b: number
  name: string
  /** metadata set index (macro behaviors use several) */
  set: number
}

/* --------------------------------------------------------------------------
 * Model types the configurator works in
 * -------------------------------------------------------------------------- */

/** A binding as the firmware stores it: a token plus its two params.
 * KEEB_TOKEN_NONE means the grid slot is not mapped at all; a real binding is
 * always a real token, including &trans (inherit) and &none (disabled). */
export interface Binding {
  token: number
  param1: number
  param2: number
}

/** One position of a layer, as edited locally before it is sent. */
export interface Cell extends Binding {
  pos: number
  flags: number
}

/** A layer slot: ZMK's slot index and the layer id currently living in it. */
export interface LayerSlot {
  /** slot index in the fixed pool (0..capacity-1) */
  index: number
  /** layer id ZMK reports for this slot, -1 when the slot is empty/removed */
  id: number
  name: string
  /** true when the slot holds a layer the keymap file defines, i.e. capacity
   * that can be restored rather than only re-added */
  stock: boolean
}

/** A token in the firmware's table (see zmk.gen.ts for the generated table). */
export interface TokenDef {
  id: number
  /** devicetree label, e.g. "kp" — display only, never sent */
  label: string
  /** devicetree node name, e.g. "key_press" — the string ZMK resolves */
  name: string
  bindingCells: number | null
  displayName: string | null
  compatible: string | null
}

/** One position of the stock grid: where a position number sits on screen. */
export interface GridCell {
  pos: number
  row: number
  /** global column: left half 0-5, right half 6-11 */
  col: number
  side: 'L' | 'R'
}

export interface StockBinding {
  token: number
  param1: number
  param2: number
}

export interface StockLayer {
  name: string
  cells: StockBinding[]
}

/** What the host knows about the connected keyboard after INFO + TOKENS. */
export interface Capabilities {
  info: InfoPayload
  tokens: TokenRecord[]
  /** true when the token table the UI was generated from matches the device */
  tokenTableMatches: boolean
}

/** One pending write, kept so the UI can show what has not landed yet. */
export interface PendingChange {
  layerId: number
  pos: number
  before: Binding | null
  after: Binding
}
