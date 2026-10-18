/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * KEEB TLV codec — the TypeScript mirror of keeb-module/proto/keeb_tlv.c.
 *
 * The rule for this file: every function here has a counterpart in the C
 * codec, and its accept/reject behaviour is the same. That is what makes a
 * parity test meaningful, and it is why the odd-looking parts are kept odd:
 *
 *   - offsets are written explicitly instead of relying on a DataView of a
 *     "struct", because the wire layout is the protocol;
 *   - reassembly requires in-order fragments with the FIRST flag on the first
 *     one, because the command channel is write-without-response and a
 *     fragment can genuinely be lost (keeb_tlv.h, "Framing");
 *   - a rejected packet is an error the caller must report, because the only
 *     legal recovery is the sender restarting the message at offset 0.
 *
 * tests/codec.test.ts runs the same assertions tools/tlv_test.c runs.
 */

import {
  KEEB_CELL_F_RESERVED,
  KEEB_ERR_BAD_LEN,
  KEEB_ERR_BAD_MAGIC,
  KEEB_ERR_BAD_SEQ,
  KEEB_ERR_BAD_VERSION,
  KEEB_ERR_BUSY,
  KEEB_ERR_TOO_BIG,
  KEEB_PKT_F_FIRST,
  KEEB_PKT_HDR_SIZE,
  KEEB_TLV_FRAG_MAX,
  KEEB_TLV_FRAG_MIN,
  KEEB_ERR_BAD_CRC,
  KEEB_TLV_MAGIC,
  KEEB_TLV_MSG_MAX,
  KEEB_TLV_VERSION,
  KEEB_T_CELLS_SET,
  KEEB_T_LAYER_NAME_SET,
  KEEB_TOKEN_F_READY,
  KEEB_TX_BUSY,
  KEEB_TX_MTU,
} from './constants.ts'
import { crc32, crc32Final, crc32Update } from './crc32.ts'
import type {
  AckPayload,
  Binding,
  Cell,
  CellPayload,
  CellSetPayload,
  InfoPayload,
  LayersPayload,
  NotifyHeader,
  ParamValue,
  PktHdr,
  TlvRecord,
  TokenRecord,
} from './types.ts'

/* --------------------------------------------------------------------------
 * Packet header
 * -------------------------------------------------------------------------- */

export function packPacketHeader(hdr: PktHdr): Uint8Array {
  const out = new Uint8Array(KEEB_PKT_HDR_SIZE)
  const dv = new DataView(out.buffer)

  dv.setUint16(0, hdr.magic, true)
  out[2] = hdr.version & 0xff
  out[3] = hdr.flags & 0xff
  dv.setUint16(4, hdr.msgId, true)
  dv.setUint16(6, hdr.fragOff, true)
  dv.setUint16(8, hdr.fragLen, true)
  dv.setUint16(10, hdr.msgLen, true)
  dv.setUint32(12, hdr.crc, true)

  return out
}

/** Returns null when the buffer is too short for a header. */
export function unpackPacketHeader(pkt: Uint8Array): PktHdr | null {
  if (pkt.length < KEEB_PKT_HDR_SIZE) {
    return null
  }

  const dv = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength)

  return {
    magic: dv.getUint16(0, true),
    version: dv.getUint8(2),
    flags: dv.getUint8(3),
    msgId: dv.getUint16(4, true),
    fragOff: dv.getUint16(6, true),
    fragLen: dv.getUint16(8, true),
    msgLen: dv.getUint16(10, true),
    crc: dv.getUint32(12, true),
  }
}

/* --------------------------------------------------------------------------
 * Building a message
 * -------------------------------------------------------------------------- */

/** A message under construction: records appended to one buffer, capped at
 * KEEB_TLV_MSG_MAX like both firmware buffers are. */
export class TlvMessage {
  readonly buf: Uint8Array
  len = 0

  constructor(cap: number = KEEB_TLV_MSG_MAX) {
    this.buf = new Uint8Array(cap)
  }

  get capacity(): number {
    return this.buf.length
  }

  /** Append a record header and reserve `valueLen` payload bytes. Returns a
   * DataView over the reserved payload (positioned at 0 = the record's first
   * value byte), or null when the message is full — nothing is written then,
   * which is the C codec's rule too. */
  add(type: number, valueLen: number): DataView | null {
    const need = 4 + valueLen

    if (need > this.buf.length - this.len) {
      return null
    }

    const at = this.len
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength)

    dv.setUint16(at, type, true)
    dv.setUint16(at + 2, valueLen, true)
    this.len += need

    return new DataView(this.buf.buffer, this.buf.byteOffset + at + 4, valueLen)
  }

  /** Append a record whose value is a byte block (a string, a payload blob). */
  addBytes(type: number, bytes: Uint8Array): boolean {
    const dv = this.add(type, bytes.length)

    if (!dv) {
      return false
    }

    this.buf.set(bytes, this.len - bytes.length)

    return true
  }

  /** Append a record and fill it with packed fields: [u8|u16|u32] in order. */
  addFields(type: number, fields: Array<number>, widths: Array<1 | 2 | 4>): boolean {
    const valueLen = widths.reduce((a, w) => a + w, 0)
    const dv = this.add(type, valueLen)

    if (!dv) {
      return false
    }

    let off = 0
    for (let i = 0; i < widths.length; i++) {
      const w = widths[i]
      if (w === 1) dv.setUint8(off, fields[i] & 0xff)
      else if (w === 2) dv.setUint16(off, fields[i] & 0xffff, true)
      else dv.setUint32(off, fields[i] >>> 0, true)
      off += w
    }

    return true
  }

  /** The finished message, exactly `len` bytes. */
  bytes(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

/* --------------------------------------------------------------------------
 * Iterating a message
 * -------------------------------------------------------------------------- */

export interface IterateResult {
  records: TlvRecord[]
  /** true when the stream was torn mid-record */
  malformed: boolean
}

/** Walk a message. A record that claims more bytes than are left stops the
 * walk and marks the message malformed (keeb_tlv_iter_next returning -1). */
export function iterateMessage(msg: Uint8Array): IterateResult {
  const records: TlvRecord[] = []
  let p = 0
  let left = msg.length
  const dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength)

  for (;;) {
    if (left === 0) {
      return { records, malformed: false }
    }

    if (left < 4) {
      return { records, malformed: true }
    }

    const type = dv.getUint16(p, true)
    const len = dv.getUint16(p + 2, true)

    if (len > left - 4) {
      return { records, malformed: true }
    }

    records.push({ type, len, value: msg.subarray(p + 4, p + 4 + len) })
    p += 4 + len
    left -= 4 + len
  }
}

/* --------------------------------------------------------------------------
 * Payload readers (offsets are the packed struct layouts in keeb_tlv.h)
 * -------------------------------------------------------------------------- */

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)

export function readInfo(value: Uint8Array): InfoPayload {
  const dv = view(value)

  return {
    proto: dv.getUint16(0, true),
    fwVersion: dv.getUint16(2, true),
    layerCount: dv.getUint16(4, true),
    keyCount: dv.getUint16(6, true),
    nameMax: dv.getUint16(8, true),
    tokenCount: dv.getUint16(10, true),
    tokenHash: dv.getUint32(12, true),
    flags: dv.getUint32(16, true),
  }
}

export function readAck(value: Uint8Array): AckPayload {
  const dv = view(value)

  return {
    msgId: dv.getUint16(0, true),
    status: dv.getUint8(2),
    errCode: dv.getUint8(3),
    detail: dv.getUint16(4, true),
    extra: dv.getUint32(6, true),
  }
}

export function readNotify(value: Uint8Array): NotifyHeader {
  const dv = view(value)

  return { event: dv.getUint16(0, true), seq: dv.getUint16(2, true), data: value.subarray(4) }
}

/** KEEB_T_CELLS: header + `count` 16-byte cells, in stock position order. */
export function readCells(value: Uint8Array): { layer: number; flags: number; cells: CellPayload[] } {
  const dv = view(value)
  const layer = dv.getUint8(0)
  const flags = dv.getUint8(1)
  const count = dv.getUint16(2, true)
  const cells: CellPayload[] = []

  for (let i = 0; i < count; i++) {
    const at = 4 + i * 16

    if (at + 16 > value.length) {
      break
    }

    cells.push({
      layer: dv.getUint8(at),
      flags: dv.getUint8(at + 1),
      pos: dv.getUint16(at + 2, true),
      token: dv.getUint16(at + 4, true),
      reserved: dv.getUint16(at + 6, true),
      param1: dv.getUint32(at + 8, true),
      param2: dv.getUint32(at + 12, true),
    })
  }

  return { layer, flags, cells }
}

/** KEEB_T_LAYERS: header + order[count] slot->id bytes. Names arrive as
 * separate KEEB_T_LAYER_NAME_SET records and are folded in by readLayerName. */
export function readLayers(value: Uint8Array): LayersPayload {
  const dv = view(value)
  const count = dv.getUint16(0, true)
  const order: number[] = []

  for (let i = 0; i < count && 14 + i < value.length; i++) {
    order.push(dv.getUint8(14 + i))
  }

  return {
    count,
    active: dv.getUint16(2, true),
    state: dv.getUint32(4, true),
    locked: dv.getUint32(8, true),
    nameMax: dv.getUint8(13),
    order,
    names: {},
  }
}

/** KEEB_T_LAYER_NAME_SET: one layer id byte, then the name. The same record
 * the host sends to rename a layer, which is the point (keeb_keymap.c). */
export function readLayerName(value: Uint8Array): { layer: number; name: string } {
  return { layer: value[0], name: new TextDecoder().decode(value.subarray(1)) }
}

export function writeLayerName(msg: TlvMessage, layer: number, name: string): boolean {
  const enc = new TextEncoder().encode(name)
  const dv = msg.add(KEEB_T_LAYER_NAME_SET, 1 + enc.length)

  if (!dv) {
    return false
  }

  dv.setUint8(0, layer & 0xff)
  msg.buf.set(enc, msg.len - enc.length)

  return true
}

export function readTokensHeader(value: Uint8Array): { next: number; count: number; tokenHash: number } {
  const dv = view(value)

  return { next: dv.getUint16(0, true), count: dv.getUint16(2, true), tokenHash: dv.getUint32(4, true) }
}

export function readTokenRec(value: Uint8Array): TokenRecord {
  const dv = view(value)
  const nameLen = dv.getUint8(4)

  return {
    token: dv.getUint16(0, true),
    name: new TextDecoder().decode(value.subarray(6, 6 + nameLen)),
    flags: dv.getUint8(5),
  }
}

export function readParamValue(value: Uint8Array): ParamValue {
  const dv = view(value)
  const nameLen = dv.getUint8(12)

  return {
    token: dv.getUint16(0, true),
    param: dv.getUint8(2),
    type: dv.getUint8(3),
    a: dv.getUint32(4, true),
    b: dv.getUint32(8, true),
    name: new TextDecoder().decode(value.subarray(14, 14 + nameLen)),
    set: dv.getUint8(13),
  }
}

/* --------------------------------------------------------------------------
 * Writing cells
 * -------------------------------------------------------------------------- */

/** One entry of a KEEB_T_CELLS_SET record. */
export function cellSetEntry(pos: number, binding: Binding): CellSetPayload {
  return { pos, flags: 0, token: binding.token, param1: binding.param1, param2: binding.param2 }
}

/** Append a KEEB_T_CELLS_SET record for one layer.
 *
 * The firmware validates the whole record before applying any of it, so a
 * rejected write leaves the layout untouched — the configurator does not have
 * to model a partial apply, only a resend. */
export function writeCellsSet(msg: TlvMessage, layer: number, cells: Array<{ pos: number } & Binding>): boolean {
  const dv = msg.add(KEEB_T_CELLS_SET, 4 + cells.length * 16)

  if (!dv) {
    return false
  }

  dv.setUint8(0, layer & 0xff)
  dv.setUint8(1, 0)
  dv.setUint16(2, cells.length, true)

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    const at = 4 + i * 16

    dv.setUint16(at + 0, c.pos, true)
    dv.setUint8(at + 2, 0)
    dv.setUint8(at + 3, 0)
    dv.setUint16(at + 4, c.token, true)
    dv.setUint16(at + 6, 0, true)
    dv.setUint32(at + 8, c.param1 >>> 0, true)
    dv.setUint32(at + 12, c.param2 >>> 0, true)
  }

  return true
}

/** Fold a dump into the shape the stores keep. */
export function cellsToCells(cells: CellPayload[]): Cell[] {
  return cells.map((c) => ({ pos: c.pos, flags: c.flags, token: c.token, param1: c.param1, param2: c.param2 }))
}

export const cellIsReserved = (cell: Cell | CellPayload): boolean => (cell.flags & KEEB_CELL_F_RESERVED) !== 0

/* --------------------------------------------------------------------------
 * Receiving (keeb_tlv_rx_feed)
 * -------------------------------------------------------------------------- */

export type FeedResult =
  | { kind: 'more' }
  | { kind: 'complete'; msgId: number; flags: number; msg: Uint8Array }
  | { kind: 'error'; err: number; msgId: number }

/** Offset-based reassembly with the in-order rule: fragments must arrive in
 * order and the first must carry KEEB_PKT_F_FIRST. A gap is therefore resolved
 * by the sender restarting the message, which this can always honour because
 * it sees the FIRST flag. */
export class MessageReceiver {
  private buf = new Uint8Array(KEEB_TLV_MSG_MAX)
  private msgLen = 0
  private got = 0
  private msgId = 0
  private flags = 0

  reset(): void {
    this.msgLen = 0
    this.got = 0
    this.msgId = 0
    this.flags = 0
  }

  get inProgress(): boolean {
    return this.msgLen !== 0
  }

  feed(pkt: Uint8Array): FeedResult {
    const hdr = unpackPacketHeader(pkt)

    if (!hdr) {
      return { kind: 'error', err: KEEB_ERR_BAD_LEN, msgId: 0 }
    }

    const fail = (err: number): FeedResult => ({ kind: 'error', err, msgId: hdr.msgId })

    if (hdr.magic !== KEEB_TLV_MAGIC) return fail(KEEB_ERR_BAD_MAGIC)
    if (hdr.version !== KEEB_TLV_VERSION) return fail(KEEB_ERR_BAD_VERSION)
    if (hdr.fragLen !== pkt.length - KEEB_PKT_HDR_SIZE) return fail(KEEB_ERR_BAD_LEN)
    if (hdr.msgLen === 0 || hdr.msgLen > KEEB_TLV_MSG_MAX) return fail(KEEB_ERR_TOO_BIG)
    if (hdr.fragOff > hdr.msgLen || hdr.fragLen > hdr.msgLen - hdr.fragOff) return fail(KEEB_ERR_BAD_LEN)

    if (hdr.flags & KEEB_PKT_F_FIRST) {
      this.msgLen = hdr.msgLen
      this.got = 0
      this.msgId = hdr.msgId
      this.flags = hdr.flags
    } else {
      if (this.msgLen === 0) return fail(KEEB_ERR_BAD_SEQ)
      if (hdr.msgLen !== this.msgLen || hdr.msgId !== this.msgId) return fail(KEEB_ERR_BAD_SEQ)
      if (hdr.fragOff !== this.got) return fail(KEEB_ERR_BAD_SEQ)
    }

    this.buf.set(pkt.subarray(KEEB_PKT_HDR_SIZE, KEEB_PKT_HDR_SIZE + hdr.fragLen), hdr.fragOff)
    this.got += hdr.fragLen

    if (this.got < this.msgLen) {
      return { kind: 'more' }
    }

    const msg = this.buf.slice(0, this.msgLen)
    const msgId = this.msgId
    const flags = this.flags

    this.reset()

    if (crc32(msg) !== hdr.crc) {
      return { kind: 'error', err: KEEB_ERR_BAD_CRC, msgId }
    }

    return { kind: 'complete', msgId, flags, msg }
  }
}

/* --------------------------------------------------------------------------
 * Sending (keeb_tlv_tx_start / keeb_tlv_tx_pump)
 * -------------------------------------------------------------------------- */

/** A transport's send hook. Return 0, KEEB_TX_BUSY, KEEB_TX_MTU or KEEB_TX_FAIL
 * — the same three non-success answers keeb_tlv.h defines, because the codec
 * has to react to them the same way the firmware does. */
export type SendPacket = (pkt: Uint8Array) => number

export type PumpResult = 'sent' | 'pending' | 'retry' | 'failed'

export class MessageSender {
  private msg: Uint8Array | null = null
  private msgLen = 0
  private off = 0
  private frag = 0
  private msgId = 0
  private flags = 0
  private crc = 0
  busy = false

  /* Explicit fields, not constructor parameter properties: tests/ runs this
   * file through Node's type-stripping loader, which only erases syntax that
   * has no runtime meaning. */
  private readonly sendHook: SendPacket
  private readonly maxFrag: number

  constructor(send: SendPacket, maxFrag: number = KEEB_TLV_FRAG_MAX) {
    this.sendHook = send
    this.maxFrag = maxFrag
  }

  /** Fragment size currently in use, after any MTU shrink. */
  get currentFragment(): number {
    return this.frag
  }

  /** Start sending. Refuses while a message is in flight: the engine answers
   * KEEB_ERR_BUSY for the same reason, and one configurator must not
   * interleave two streams the receiver cannot untangle. */
  start(msg: Uint8Array, msgId: number, flags: number): { ok: boolean; err?: number } {
    if (this.busy) {
      return { ok: false, err: KEEB_ERR_BUSY }
    }

    if (msg.length === 0 || msg.length > KEEB_TLV_MSG_MAX) {
      return { ok: false, err: KEEB_ERR_TOO_BIG }
    }

    let frag = Math.min(KEEB_TLV_FRAG_MAX, this.maxFrag)

    if (frag < KEEB_TLV_FRAG_MIN) {
      frag = KEEB_TLV_FRAG_MIN
    }

    this.msg = msg
    this.msgLen = msg.length
    this.off = 0
    this.frag = frag
    this.msgId = msgId
    this.flags = flags
    this.crc = crc32(msg)
    this.busy = true

    return { ok: true }
  }

  pump(): PumpResult {
    if (!this.busy || !this.msg) {
      return 'sent'
    }

    const fragLen = Math.min(this.frag, this.msgLen - this.off)
    const first = this.off === 0

    const pkt = new Uint8Array(KEEB_PKT_HDR_SIZE + fragLen)
    pkt.set(
      packPacketHeader({
        magic: KEEB_TLV_MAGIC,
        version: KEEB_TLV_VERSION,
        flags: this.flags | (first ? KEEB_PKT_F_FIRST : 0),
        msgId: this.msgId,
        fragOff: this.off,
        fragLen,
        msgLen: this.msgLen,
        crc: this.crc,
      }),
      0,
    )
    pkt.set(this.msg.subarray(this.off, this.off + fragLen), KEEB_PKT_HDR_SIZE)

    const err = this.sendHook(pkt)

    if (err === 0) {
      this.off += fragLen

      if (this.off >= this.msgLen) {
        this.busy = false
        this.msg = null
        return 'sent'
      }

      return 'pending'
    }

    if (err === KEEB_TX_MTU) {
      /* Offset-based reassembly makes re-sending the same offset legal, so a
       * smaller negotiated MTU needs no coordination: halve and retry. */
      if (this.frag > KEEB_TLV_FRAG_MIN) {
        this.frag = Math.max(KEEB_TLV_FRAG_MIN, Math.floor(this.frag / 2))
      }

      return 'pending'
    }

    if (err === KEEB_TX_BUSY) {
      /* TX pool empty: keep the fragment exactly where it is and let the
       * caller retry later. The firmware's answer to this is a delayed work
       * item (KEEB_TX_RETRY_MS), not a spin. */
      return 'retry'
    }

    this.busy = false
    this.msg = null

    return 'failed'
  }

  /** Pump until the message is out, the transport asks for a retry, or the
   * message is dropped. Never spins: 'retry' hands the decision back to the
   * caller, which is what the firmware does with a busy Bluetooth pool. */
  sendAll(msg: Uint8Array, msgId: number, flags: number): PumpResult {
    const started = this.start(msg, msgId, flags)

    if (!started.ok) {
      return 'failed'
    }

    for (;;) {
      const r = this.pump()

      if (r !== 'pending') {
        return r
      }
    }
  }
}

/* --------------------------------------------------------------------------
 * Token table hash (keeb_tokens.c build_hash)
 * -------------------------------------------------------------------------- */

/** u16 id LE | name bytes | 0x00, per token, in table order. A host that knows
 * the list can reproduce it, which is what makes the handshake meaningful. */
export function tokenTableHash(tokens: Array<{ id: number; name: string }>): number {
  const enc = new TextEncoder()
  let state = 0xffffffff

  for (const t of tokens) {
    state = crc32Update(state, new Uint8Array([t.id & 0xff, (t.id >> 8) & 0xff]))
    state = crc32Update(state, enc.encode(t.name))
    state = crc32Update(state, new Uint8Array([0]))
  }

  return crc32Final(state)
}

export const tokenReady = (t: TokenRecord): boolean => (t.flags & KEEB_TOKEN_F_READY) !== 0
