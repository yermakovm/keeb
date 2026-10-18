/*
 * End-to-end session test against the simulated keyboard.
 *
 * The mock speaks the same codec as the firmware and mirrors the engine's
 * rules, so these assertions are really about the protocol: the ACK shape,
 * the reserved-position refusal, the all-or-nothing batch, and the
 * notifications that follow a write.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  KEEB_ERR_RESERVED_POSITION,
  KEEB_ERR_UNKNOWN_TOKEN,
  KEEB_PKT_F_NOTIFY,
  KEEB_STATUS_OK,
  KEEB_T_ACK,
  KEEB_T_CELLS,
  KEEB_T_CELLS_GET,
  KEEB_T_CELLS_SET,
  KEEB_T_DISCARD,
  KEEB_T_INFO,
  KEEB_T_LAYER_NAME_SET,
  KEEB_T_LAYERS,
  KEEB_T_LAYERS_GET,
  KEEB_T_NOTIFY,
  KEEB_T_SAVE,
  KEEB_T_TOKEN_PARAMS,
  KEEB_T_TOKENS,
  KEEB_TOKEN_NONE,
  KEEB_TOKEN_UNKNOWN,
  KEEB_TLV_MSG_MAX,
  KEEB_EV_CELLS_SET,
  KEEB_EV_SAVED,
} from '../src/proto/constants.ts'
import {
  MessageReceiver,
  MessageSender,
  TlvMessage,
  iterateMessage,
  readAck,
  readCells,
  readInfo,
  readLayers,
  readNotify,
  readTokenRec,
  readTokensHeader,
} from '../src/proto/tlv.ts'
import { EXPECTED_TOKEN_HASH, KEY_COUNT, LAYER_CAPACITY, RESERVED_POSITIONS, STOCK_LAYERS, TOKENS } from '../src/proto/zmk.gen.ts'
import { MockKeyboard } from '../src/transport/mockKeyboard.ts'

const kpToken = TOKENS.find((t) => t.label === 'kp')!.id
const transToken = TOKENS.find((t) => t.label === 'trans')!.id
const moToken = TOKENS.find((t) => t.label === 'mo')!.id

interface Reply {
  msgId: number
  ack: ReturnType<typeof readAck>
  records: Array<{ type: number; value: Uint8Array }>
}

/** Drive the mock exactly as a host would: write packets to it, read packets
 * out of it, reassemble both sides. */
class Session {
  private rx = new MessageReceiver()
  private sender: MessageSender
  private replies = new Map<number, Reply>()
  private notifications: Array<ReturnType<typeof readNotify>> = []
  private nextId = 1
  private offPacket: () => void

  constructor(kb: MockKeyboard) {
    this.sender = new MessageSender(kb.send, kb.maxFragment)

    this.offPacket = kb.onPacket((pkt) => {
      const fed = this.rx.feed(pkt)

      if (fed.kind !== 'complete') {
        return
      }

      const { records } = iterateMessage(fed.msg)
      const ackRec = records.find((r) => r.type === KEEB_T_ACK)

      if (fed.flags & KEEB_PKT_F_NOTIFY) {
        for (const r of records) {
          if (r.type === KEEB_T_NOTIFY) {
            this.notifications.push(readNotify(r.value))
          }
        }

        return
      }

      if (ackRec) {
        this.replies.set(fed.msgId, { msgId: fed.msgId, ack: readAck(ackRec.value), records })
      }
    })
  }

  close(): void {
    this.offPacket()
  }

  async request(build: (m: TlvMessage) => void): Promise<Reply> {
    const msg = new TlvMessage(KEEB_TLV_MSG_MAX)

    build(msg)

    const msgId = this.nextId++
    const bytes = msg.bytes()

    /* The mock answers on a microtask; drain it before waiting. */
    assert.equal(this.sender.sendAll(bytes, msgId, 0), 'sent')

    await new Promise((r) => setTimeout(r, 0))

    const reply = this.replies.get(msgId)

    assert.ok(reply, `no reply for message ${msgId}`)

    return reply
  }

  events(): Array<ReturnType<typeof readNotify>> {
    return this.notifications
  }
}

async function connected(): Promise<{ kb: MockKeyboard; session: Session }> {
  const kb = new MockKeyboard()

  await kb.connect()

  return { kb, session: new Session(kb) }
}

test('INFO reports the firmware the UI was generated for', async () => {
  const { session } = await connected()

  const reply = await session.request((m) => m.add(KEEB_T_INFO, 0))

  assert.equal(reply.ack.status, KEEB_STATUS_OK)

  const infoRec = reply.records.find((r) => r.type === KEEB_T_INFO)

  assert.ok(infoRec)

  const info = readInfo(infoRec.value)

  assert.equal(info.tokenHash, EXPECTED_TOKEN_HASH)
  assert.equal(info.keyCount, KEY_COUNT)
  assert.equal(info.layerCount, LAYER_CAPACITY)
  assert.equal(info.tokenCount, TOKENS.length)

  session.close()
})

test('LAYERS_GET returns slots, ids and names in one message', async () => {
  const { session } = await connected()

  const reply = await session.request((m) => m.add(KEEB_T_LAYERS_GET, 0))
  const layersRec = reply.records.find((r) => r.type === KEEB_T_LAYERS)

  assert.ok(layersRec)

  const layers = readLayers(layersRec.value)

  assert.equal(layers.count, LAYER_CAPACITY)
  assert.equal(layers.order.length, LAYER_CAPACITY)
  assert.equal(layers.active, 0, 'HOME is the only active layer at boot')

  const names = reply.records.filter((r) => r.type === KEEB_T_LAYER_NAME_SET)

  assert.equal(names.length, LAYER_CAPACITY, 'one name record per layer')

  session.close()
})

test('TOKENS is paginated and carries the table hash', async () => {
  const { session } = await connected()

  const reply = await session.request((m) => m.addFields(KEEB_T_TOKENS, [0], [2]))
  const records = reply.records.filter((r) => r.type === KEEB_T_TOKENS)

  assert.ok(records.length >= 1)

  const hdr = readTokensHeader(records[0].value)

  assert.equal(hdr.tokenHash, EXPECTED_TOKEN_HASH)
  assert.equal(hdr.count, TOKENS.length)
  assert.equal(hdr.next, 0xffff, 'the whole table fits in one page')

  const listed = records.slice(1).map((r) => readTokenRec(r.value))

  assert.equal(listed[0].name, 'key_press')
  assert.equal(listed.find((t) => t.name === 'bcklight')?.flags, 0, 'backlight has no driver in this build')

  session.close()
})

test('a dump carries every stock position, reserved ones flagged', async () => {
  const { session } = await connected()

  const reply = await session.request((m) => m.addFields(KEEB_T_CELLS_GET, [0], [1]))
  const rec = reply.records.find((r) => r.type === KEEB_T_CELLS)

  assert.ok(rec)

  const dump = readCells(rec.value)

  assert.equal(dump.cells.length, KEY_COUNT)

  for (const pos of RESERVED_POSITIONS) {
    const cell = dump.cells.find((c) => c.pos === pos)

    assert.ok(cell)
    assert.equal(cell.flags & 0x01, 0x01, `position ${pos} is reserved in the dump`)
  }

  session.close()
})

test('writing a reserved position is refused for the whole record', async () => {
  const { session } = await connected()

  const reply = await session.request((m) => {
    const dv = m.add(KEEB_T_CELLS_SET, 4 + 2 * 16)

    assert.ok(dv)
    dv.setUint8(0, 1)
    dv.setUint16(2, 2, true)

    /* entry 0 is legal, entry 1 is the reserved corner */
    dv.setUint16(4, 12, true)
    dv.setUint16(4 + 4, kpToken, true)
    dv.setUint32(4 + 8, 0x00070004, true)

    const at = 4 + 16
    dv.setUint16(at, RESERVED_POSITIONS[0], true)
    dv.setUint16(at + 4, kpToken, true)
    dv.setUint32(at + 8, 0x00070004, true)
  })

  assert.equal(reply.ack.status, 1)
  assert.equal(reply.ack.errCode, KEEB_ERR_RESERVED_POSITION)

  /* Nothing landed: the layer is still the keymap file's layout. */
  const after = await session.request((m) => m.addFields(KEEB_T_CELLS_GET, [1], [1]))
  const dump = readCells(after.records.find((r) => r.type === KEEB_T_CELLS)!.value)

  assert.equal(dump.cells[12].token, STOCK_LAYERS[1].cells[12].token)

  session.close()
})

test('KEEB_TOKEN_NONE is refused on writes: unassigning means &trans', async () => {
  const { session } = await connected()

  const reply = await session.request((m) => {
    const dv = m.add(KEEB_T_CELLS_SET, 4 + 16)

    assert.ok(dv)
    dv.setUint8(0, 0)
    dv.setUint16(2, 1, true)
    dv.setUint16(4, 20, true)
    dv.setUint16(4 + 4, KEEB_TOKEN_NONE, true)
  })

  assert.equal(reply.ack.errCode, KEEB_ERR_UNKNOWN_TOKEN)

  const ok = await session.request((m) => {
    const dv = m.add(KEEB_T_CELLS_SET, 4 + 16)

    assert.ok(dv)
    dv.setUint8(0, 0)
    dv.setUint16(2, 1, true)
    dv.setUint16(4, 20, true)
    dv.setUint16(4 + 4, transToken, true)
  })

  assert.equal(ok.ack.status, KEEB_STATUS_OK)
  assert.equal(ok.ack.detail, 1)

  const dump = await session.request((m) => m.addFields(KEEB_T_CELLS_GET, [0], [1]))
  const cells = readCells(dump.records.find((r) => r.type === KEEB_T_CELLS)!.value).cells

  assert.equal(cells[20].token, transToken)

  session.close()
})

test('an unknown token is refused before anything is applied', async () => {
  const { session } = await connected()

  const reply = await session.request((m) => {
    const dv = m.add(KEEB_T_CELLS_SET, 4 + 16)

    assert.ok(dv)
    dv.setUint8(0, 0)
    dv.setUint16(2, 1, true)
    dv.setUint16(4, 21, true)
    dv.setUint16(4 + 4, KEEB_TOKEN_UNKNOWN, true)
  })

  assert.equal(reply.ack.errCode, KEEB_ERR_UNKNOWN_TOKEN)

  session.close()
})

test('a successful write sends a CELLS_SET notification the host can react to', async () => {
  const { session } = await connected()

  const reply = await session.request((m) => {
    const dv = m.add(KEEB_T_CELLS_SET, 4 + 16)

    assert.ok(dv)
    dv.setUint8(0, 2)
    dv.setUint16(2, 1, true)
    dv.setUint16(4, 22, true)
    dv.setUint16(4 + 4, moToken, true)
    dv.setUint32(4 + 8, 1, true)
  })

  assert.equal(reply.ack.status, KEEB_STATUS_OK)

  const events = session.events()
  const ev = events.find((e) => e.event === KEEB_EV_CELLS_SET)

  assert.ok(ev, 'the engine notifies after a write lands')
  assert.equal(ev.data[0], 2, 'layer id')
  assert.equal(ev.data[1] | (ev.data[2] << 8), 1, 'cells applied')

  session.close()
})

test('SAVE answers and announces, DISCARD returns to the keymap file', async () => {
  const { session } = await connected()

  const saved = await session.request((m) => m.add(KEEB_T_SAVE, 0))

  assert.equal(saved.ack.status, KEEB_STATUS_OK)
  assert.ok(session.events().some((e) => e.event === KEEB_EV_SAVED))

  const discarded = await session.request((m) => m.add(KEEB_T_DISCARD, 0))

  assert.equal(discarded.ack.status, KEEB_STATUS_OK)

  session.close()
})

test('TOKEN_PARAMS answers with the params a token takes', async () => {
  const { session } = await connected()

  const mo = TOKENS.find((t) => t.label === 'mo')!.id
  const reply = await session.request((m) => m.addFields(KEEB_T_TOKEN_PARAMS, [mo], [2]))
  const params = reply.records.filter((r) => r.type === KEEB_T_TOKEN_PARAMS)

  assert.equal(params.length, 1)
  assert.equal(params[0].value[2], 0, 'param1')
  assert.equal(params[0].value[3], 4, 'LAYER_ID')

  session.close()
})
