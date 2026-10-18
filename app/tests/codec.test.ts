/*
 * Codec parity tests.
 *
 * These are the same assertions tools/tlv_test.c makes against the C codec,
 * run against the TypeScript one. Where a number appears here it is because
 * the firmware produces it, not because the test wanted one.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { crc32, crc32Final, crc32Update } from '../src/proto/crc32.ts'
import {
  KEEB_ERR_BAD_CRC,
  KEEB_ERR_BAD_LEN,
  KEEB_ERR_BAD_MAGIC,
  KEEB_ERR_BAD_SEQ,
  KEEB_ERR_BAD_VERSION,
  KEEB_ERR_TOO_BIG,
  KEEB_ERR_UNKNOWN_TYPE,
  KEEB_PKT_F_FIRST,
  KEEB_PKT_F_REPLY,
  KEEB_PKT_HDR_SIZE,
  KEEB_T_ACK,
  KEEB_T_CELLS_SET,
  KEEB_TLV_MAGIC,
  KEEB_TLV_VERSION,
  KEEB_TX_BUSY,
  KEEB_TX_FAIL,
  KEEB_TX_MTU,
} from '../src/proto/constants.ts'
import {
  MessageReceiver,
  MessageSender,
  TlvMessage,
  iterateMessage,
  packPacketHeader,
  tokenTableHash,
  unpackPacketHeader,
  writeCellsSet,
} from '../src/proto/tlv.ts'
import { EXPECTED_TOKEN_HASH, TOKENS } from '../src/proto/zmk.gen.ts'

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

test('CRC-32/IEEE check value matches the C codec', () => {
  assert.equal(crc32(bytes('123456789')), 0xcbf43926)
})

test('streamed CRC equals one-shot', () => {
  const data = bytes('123456789')
  let state = 0xffffffff

  state = crc32Update(state, data, 0, 4)
  state = crc32Update(state, data, 4, 5)

  assert.equal(crc32Final(state), 0xcbf43926)
})

test('packet header is 16 bytes, little-endian', () => {
  const wire = packPacketHeader({
    magic: KEEB_TLV_MAGIC,
    version: KEEB_TLV_VERSION,
    flags: KEEB_PKT_F_REPLY,
    msgId: 0x0102,
    fragOff: 0x0304,
    fragLen: 0x0506,
    msgLen: 0x0708,
    crc: 0x0b0c0d0e,
  })

  assert.equal(wire.length, KEEB_PKT_HDR_SIZE)
  assert.equal(wire[4], 0x02, 'msg_id low byte first')
  assert.equal(wire[5], 0x01, 'msg_id high byte second')
  assert.equal(wire[12], 0x0e, 'crc byte 0')
  assert.equal(wire[15], 0x0b, 'crc last byte')

  const back = unpackPacketHeader(wire)

  assert.ok(back)
  assert.equal(back.msgId, 0x0102)
  assert.equal(back.msgLen, 0x0708)
  assert.equal(back.crc, 0x0b0c0d0e)
})

test('build then iterate round-trips', () => {
  const msg = new TlvMessage()

  assert.ok(msg.add(KEEB_T_ACK, 10))
  /* 0x0007 is a SYS-namespace op the firmware does not implement: it exists
   * here only to prove the iterator handles records of different sizes. */
  msg.addFields(0x0007, [0x1234], [2])

  const { records, malformed } = iterateMessage(msg.bytes())

  assert.equal(malformed, false)
  assert.equal(records.length, 2)
  assert.equal(records[0].type, KEEB_T_ACK)
  assert.equal(records[0].len, 10)
  assert.equal(records[1].len, 2)
})

test('a torn record stops the walk and is reported', () => {
  const torn = new Uint8Array([0x01, 0x10, 0xff, 0xff])
  const { records, malformed } = iterateMessage(torn)

  assert.equal(malformed, true, 'record claims 0xffff bytes with 4 present')
  assert.equal(records.length, 0)

  const short = new Uint8Array([0x01, 0x00, 0x00])

  assert.equal(iterateMessage(short).malformed, true, 'header shorter than 4 bytes')
})

test('a full-size message fits the firmware buffer', () => {
  const msg = new TlvMessage()

  /* One layer of 60 positions: header + 60 * 16 = 964 bytes, the number
   * KEEB_TLV_MSG_MAX (1024) is sized for. */
  const cells = Array.from({ length: 60 }, (_, pos) => ({ pos, token: 0, param1: 0x00070004, param2: 0 }))

  assert.equal(writeCellsSet(msg, 0, cells), true)
  assert.equal(msg.len, 4 + 4 + 60 * 16)
  assert.ok(msg.len <= 1024)
})

test('a record that would overflow the buffer writes nothing', () => {
  const msg = new TlvMessage(8)

  assert.equal(msg.add(KEEB_T_ACK, 10), null)
  assert.equal(msg.len, 0)
})

/* --------------------------------------------------------------------------
 * Reassembly
 * -------------------------------------------------------------------------- */

function fragment(msg: Uint8Array, msgId: number, off: number, len: number, first: boolean): Uint8Array {
  const fragLen = Math.min(len, msg.length - off)
  const pkt = new Uint8Array(KEEB_PKT_HDR_SIZE + fragLen)

  pkt.set(
    packPacketHeader({
      magic: KEEB_TLV_MAGIC,
      version: KEEB_TLV_VERSION,
      flags: KEEB_PKT_F_REPLY | (first ? KEEB_PKT_F_FIRST : 0),
      msgId,
      fragOff: off,
      fragLen,
      msgLen: msg.length,
      crc: crc32(msg),
    }),
    0,
  )
  pkt.set(msg.subarray(off, off + fragLen), KEEB_PKT_HDR_SIZE)

  return pkt
}

test('fragments reassemble in order', () => {
  const msg = new Uint8Array(60).fill(0x11)
  const rx = new MessageReceiver()

  let r = rx.feed(fragment(msg, 7, 0, 20, true))

  assert.equal(r.kind, 'more')

  r = rx.feed(fragment(msg, 7, 20, 40, false))

  assert.equal(r.kind, 'complete')

  if (r.kind === 'complete') {
    assert.deepEqual([...r.msg], [...msg])
    assert.equal(r.msgId, 7)
  }
})

test('a gap is a sequence error, and the fix is a restart from offset 0', () => {
  const msg = new Uint8Array(60).fill(0x5a)
  const rx = new MessageReceiver()

  rx.feed(fragment(msg, 3, 0, 20, true))

  const dropped = rx.feed(fragment(msg, 3, 40, 20, false))

  assert.equal(dropped.kind, 'error')

  if (dropped.kind === 'error') {
    assert.equal(dropped.err, KEEB_ERR_BAD_SEQ)
  }

  const restart = rx.feed(fragment(msg, 3, 0, 20, true))

  assert.equal(restart.kind, 'more', 'FIRST resets the receiver, as the protocol requires')
})

test('a corrupted byte is caught at completion, not per fragment', () => {
  const msg = new Uint8Array(30).fill(0x3c)
  const rx = new MessageReceiver()

  rx.feed(fragment(msg, 4, 0, 20, true))

  const bad = fragment(msg, 4, 20, 10, false)

  bad[KEEB_PKT_HDR_SIZE] ^= 0x80

  const r = rx.feed(bad)

  assert.equal(r.kind, 'error')

  if (r.kind === 'error') {
    assert.equal(r.err, KEEB_ERR_BAD_CRC)
  }
})

for (const [name, mutate, expected] of [
  ['bad magic', (h: { magic: number }) => (h.magic = 0x1234), KEEB_ERR_BAD_MAGIC],
  ['bad version', (h: { version: number }) => (h.version = 9), KEEB_ERR_BAD_VERSION],
  ['zero message length', (h: { msgLen: number }) => (h.msgLen = 0), KEEB_ERR_TOO_BIG],
  ['oversized message', (h: { msgLen: number }) => (h.msgLen = 4096), KEEB_ERR_TOO_BIG],
] as const) {
  test(`header rejection: ${name}`, () => {
    const hdr = {
      magic: KEEB_TLV_MAGIC,
      version: KEEB_TLV_VERSION,
      flags: KEEB_PKT_F_FIRST,
      msgId: 1,
      fragOff: 0,
      fragLen: 4,
      msgLen: 8,
      crc: 0,
    }

    mutate(hdr)

    const pkt = new Uint8Array(KEEB_PKT_HDR_SIZE + 4)

    pkt.set(packPacketHeader(hdr), 0)

    const r = new MessageReceiver().feed(pkt)

    assert.equal(r.kind, 'error')

    if (r.kind === 'error') {
      assert.equal(r.err, expected)
    }
  })
}

test('a short packet is a length error', () => {
  const r = new MessageReceiver().feed(new Uint8Array(3))

  assert.equal(r.kind, 'error')

  if (r.kind === 'error') {
    assert.equal(r.err, KEEB_ERR_BAD_LEN)
  }
})

/* --------------------------------------------------------------------------
 * Sending
 * -------------------------------------------------------------------------- */

test('fragmentation splits a 700 byte message and stops cleanly', () => {
  const sent: Uint8Array[] = []
  const sender = new MessageSender((p) => {
    sent.push(p)

    return 0
  }, 62)

  const msg = new Uint8Array(700).fill(0xa5)
  const r = sender.sendAll(msg, 1, KEEB_PKT_F_REPLY)

  assert.equal(r, 'sent')
  assert.equal(sent.length, Math.ceil(700 / 62))
  const first = unpackPacketHeader(sent[0])
  const second = unpackPacketHeader(sent[1])

  assert.ok(first && second)
  assert.equal(first.flags & KEEB_PKT_F_FIRST, KEEB_PKT_F_FIRST)
  assert.equal(second.flags & KEEB_PKT_F_FIRST, 0)
  assert.equal(sender.busy, false)
})

test('a busy link pauses the message without dropping it', () => {
  const offsets: number[] = []
  let busyOnce = true

  const sender = new MessageSender((p) => {
    const hdr = unpackPacketHeader(p)

    assert.ok(hdr)

    if (busyOnce) {
      busyOnce = false

      return KEEB_TX_BUSY
    }

    offsets.push(hdr.fragOff)

    return 0
  }, 62)

  const msg = new Uint8Array(200).fill(1)

  assert.equal(sender.sendAll(msg, 2, 0), 'retry', 'the caller decides when to try again')
  assert.equal(sender.busy, true, 'the message is still in flight')

  for (;;) {
    const r = sender.pump()

    if (r === 'sent') {
      break
    }

    assert.equal(r, 'pending')
  }

  assert.deepEqual(offsets, [0, 62, 124, 186], 'the busy fragment was re-sent unchanged')
})

test('a smaller MTU shrinks the fragment and re-sends the same offset', () => {
  const offsets: number[] = []
  const frags: number[] = []
  let shrunk = false

  const sender = new MessageSender((p) => {
    const hdr = unpackPacketHeader(p)

    assert.ok(hdr)
    offsets.push(hdr.fragOff)
    frags.push(hdr.fragLen)

    if (!shrunk) {
      shrunk = true

      return KEEB_TX_MTU
    }

    return 0
  }, 62)

  const msg = new Uint8Array(100).fill(2)

  assert.equal(sender.sendAll(msg, 3, 0), 'sent')
  assert.equal(offsets[0], 0)
  assert.equal(offsets[1], 0, 'the refused offset was re-sent')
  assert.ok(frags[1] < frags[0], 'the fragment shrank')
  assert.ok(frags[1] >= 20, 'never below the BLE minimum')
})

test('a hard transport failure drops the message', () => {
  const sender = new MessageSender(() => KEEB_TX_FAIL, 62)

  assert.equal(sender.sendAll(new Uint8Array(40).fill(3), 4, 0), 'failed')
  assert.equal(sender.busy, false)
})

test('two messages at once are refused, like the engine refuses them', () => {
  const sender = new MessageSender(() => 0, 62)

  assert.equal(sender.start(new Uint8Array(40).fill(4), 5, 0).ok, true)
  assert.equal(sender.start(new Uint8Array(40).fill(4), 6, 0).ok, false)
})

/* --------------------------------------------------------------------------
 * The token table the UI was generated from
 * -------------------------------------------------------------------------- */

test('the generated token hash is reproducible from the table itself', () => {
  assert.equal(tokenTableHash(TOKENS), EXPECTED_TOKEN_HASH)
  assert.equal(TOKENS.length, 28)
  assert.equal(TOKENS[0].name, 'key_press')
  assert.equal(TOKENS[0].label, 'kp')
})

test('record types are the firmware namespace encoding', () => {
  assert.equal(KEEB_T_ACK >> 12, 0x0, 'SYS namespace')
  assert.equal(KEEB_T_CELLS_SET >> 12, 0x1, 'KEYMAP namespace')
  assert.equal(KEEB_ERR_UNKNOWN_TYPE, 7)
})
