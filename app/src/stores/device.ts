/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Device session: the conversation with one keyboard.
 *
 * Three rules the store exists to enforce, all of them from the firmware:
 *
 *   1. One message in flight. keeb_engine_rx() answers KEEB_ERR_BUSY while a
 *      reply is owed, because the engine reuses its reassembly and reply
 *      buffers. A configurator that pipelines requests would only learn that
 *      the second one was refused, so the queue here is serial by design.
 *   2. Every request is answered by exactly one ACK with msg_id echoed. A
 *      request without an ACK is unresolved, not successful — the command
 *      channel is write-without-response, so a fragment can genuinely be lost.
 *   3. The token table is verified before anything is written. Token ids are
 *      devicetree order; if the UI's table and the image's table disagree, a
 *      write would bind whatever the *firmware* thinks that id means.
 */

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import {
  KEEB_ERR_TEXT,
  KEEB_T_ACK,
  KEEB_T_CELLS,
  KEEB_T_CELLS_GET,
  KEEB_T_CELLS_SET,
  KEEB_T_INFO,
  KEEB_T_LAYER_ADD,
  KEEB_T_LAYER_MOVE,
  KEEB_T_LAYER_NAME_SET,
  KEEB_T_LAYER_REMOVE,
  KEEB_T_LAYER_RESTORE,
  KEEB_T_LAYERS,
  KEEB_T_LAYERS_GET,
  KEEB_T_NOTIFY,
  KEEB_T_PING,
  KEEB_T_RESET,
  KEEB_T_SAVE,
  KEEB_T_DISCARD,
  KEEB_T_TOKEN_PARAMS,
  KEEB_T_TOKENS,
  KEEB_TOKEN_F_READY,
  KEEB_TLV_MSG_MAX,
  KEEB_PKT_F_NOTIFY,
  KEEB_STATUS_ERR,
  KEEB_TOKEN_NONE,
  KEEB_TOKEN_UNKNOWN,
  KEEB_TLV_FRAG_MIN,
} from '../proto/constants.ts'
import {
  MessageReceiver,
  MessageSender,
  TlvMessage,
  iterateMessage,
  readAck,
  readCells as decodeCells,
  readInfo,
  readLayerName,
  readLayers as decodeLayers,
  readNotify,
  readParamValue,
  readTokenRec,
  readTokensHeader,
  tokenTableHash,
  writeLayerName,
} from '../proto/tlv.ts'
import { TOKENS } from '../proto/zmk.gen.ts'
import type { AckPayload, Binding, Capabilities, InfoPayload, LayersPayload, ParamValue, TokenRecord } from '../proto/types.ts'
import { BleTransport } from '../transport/ble.ts'
import { MockKeyboard } from '../transport/mockKeyboard.ts'
import type { KeebTransport, TransportState } from '../transport/types.ts'

export type TransportKind = 'mock' | 'ble'

export interface DeviceEvent {
  event: number
  seq: number
  data: Uint8Array
}

interface Pending {
  msgId: number
  bytes: Uint8Array
  resolve: (ack: AckPayload) => void
  reject: (err: Error) => void
  onRecord?: (type: number, value: Uint8Array) => void
  timer: ReturnType<typeof setTimeout>
}

const ACK_TIMEOUT_MS = 4000
const MAX_SHRINK_RETRIES = 3

export const useDeviceStore = defineStore('device', () => {
  const transport = shallowRef<KeebTransport | null>(null)
  const kind = ref<TransportKind | null>(null)
  const state = ref<TransportState>('offline')
  const label = ref('')
  const statusLine = ref('no keyboard connected')

  const info = ref<InfoPayload | null>(null)
  const tokens = ref<TokenRecord[]>([])
  const tokenTableMatches = ref(false)
  const lastError = ref<string | null>(null)

  const localTokenHash = tokenTableHash(TOKENS)

  let receiver = new MessageReceiver()
  let nextMsgId = 1
  let pending: Pending | null = null
  let sending: MessageSender | null = null
  const eventListeners = new Set<(e: DeviceEvent) => void>()
  const packetUnsub: Array<() => void> = []

  const connected = computed(() => state.value === 'connected')

  /** True when the connected keyboard's token table is the one this UI was
   * generated from. Writes are refused without it. */
  const writable = computed(() => connected.value && info.value !== null && tokenTableMatches.value)

  const readyTokens = computed(() => tokens.value.filter((t) => (t.flags & KEEB_TOKEN_F_READY) !== 0))

  function onEvent(cb: (e: DeviceEvent) => void): () => void {
    eventListeners.add(cb)

    return () => eventListeners.delete(cb)
  }

  function fail(message: string): void {
    lastError.value = message
    statusLine.value = message
  }

  /* ---------------------------------------------------------------- session */

  async function attach(t: KeebTransport, as: TransportKind): Promise<void> {
    detach()

    transport.value = t
    kind.value = as
    receiver = new MessageReceiver()
    nextMsgId = 1
    pending = null
    sending = null
    info.value = null
    tokens.value = []
    tokenTableMatches.value = false
    lastError.value = null

    packetUnsub.push(
      t.onPacket(onPacket),
      t.onState((s, detail) => {
        state.value = s
        statusLine.value = detail || s

        if (s !== 'connected') {
          abortPending('link closed before the keyboard answered')
        }
      }),
    )

    if (t.onShrink) {
      packetUnsub.push(
        t.onShrink((maxFragment) => {
          /* The link negotiated a smaller fragment: restart the message from
           * offset 0, which is legal precisely because reassembly is
           * offset-based and the first fragment carries FIRST. */
          if (pending && sending) {
            statusLine.value = `MTU ${maxFragment}, restarting message`
            resend(pending.msgId)
          }
        }),
      )
    }

    label.value = t.label

    await t.connect()
  }

  function detach(): void {
    for (const off of packetUnsub) {
      off()
    }

    packetUnsub.length = 0
    abortPending('disconnected')

    if (transport.value) {
      transport.value.disconnect()
    }

    transport.value = null
    kind.value = null
    state.value = 'offline'
    info.value = null
    tokens.value = []
    tokenTableMatches.value = false
  }

  async function connectMock(): Promise<void> {
    await attach(new MockKeyboard(), 'mock')
  }

  async function connectBle(): Promise<void> {
    await attach(new BleTransport(), 'ble')
  }

  function disconnect(): void {
    detach()
    statusLine.value = 'disconnected'
  }

  /* ---------------------------------------------------------------- requests */

  interface QueuedRequest {
    build: (msg: TlvMessage) => void
    onRecord?: (type: number, value: Uint8Array) => void
    resolve: (ack: AckPayload) => void
    reject: (err: Error) => void
  }

  /** Requests are queued, not pipelined. The engine answers KEEB_ERR_BUSY
   * while a reply is owed, and a notification can arrive while a request is
   * still in flight (a refresh triggered by an event), so the serialisation
   * has to live here rather than in each caller. */
  const queue: QueuedRequest[] = []

  function request(
    build: (msg: TlvMessage) => void,
    onRecord?: (type: number, value: Uint8Array) => void,
  ): Promise<AckPayload> {
    if (!transport.value || state.value !== 'connected') {
      return Promise.reject(new Error('not connected'))
    }

    return new Promise<AckPayload>((resolve, reject) => {
      queue.push({ build, onRecord, resolve, reject })

      if (!pending) {
        pumpQueue()
      }
    })
  }

  function pumpQueue(): void {
    const next = queue.shift()

    if (!next || pending) {
      return
    }

    const msg = new TlvMessage(KEEB_TLV_MSG_MAX)

    next.build(msg)

    if (msg.len === 0) {
      next.reject(new Error('empty request'))
      pumpQueue()

      return
    }

    const bytes = msg.bytes()
    const msgId = nextMsgId++

    pending = {
      msgId,
      bytes,
      resolve: next.resolve,
      reject: next.reject,
      onRecord: next.onRecord,
      timer: setTimeout(() => {
        abortPending(`no ACK for message ${msgId} in ${ACK_TIMEOUT_MS} ms`)
      }, ACK_TIMEOUT_MS),
    }

    transmit(bytes, msgId, 0, 0)
  }

  const TX_RETRY_MS = 20
  const MAX_NO_PROGRESS = 16

  function transmit(bytes: Uint8Array, msgId: number, maxFragment: number, attempt: number): void {
    if (!transport.value) {
      return
    }

    const sender = new MessageSender(transport.value.send, maxFragment || transport.value.maxFragment)

    sending = sender

    const started = sender.start(bytes, msgId, 0)

    if (!started.ok) {
      abortPending(KEEB_ERR_TEXT[started.err ?? 0] ?? 'send refused')
      return
    }

    drain(sender, msgId, bytes, attempt)
  }

  /** Pump the in-flight message. 'retry' means the link is momentarily full —
   * keep the message where it is and come back on a timer, which is what the
   * firmware's delayed work item does. 'failed' means it was dropped, so
   * restart from offset 0 at a smaller fragment (legal because reassembly is
   * offset-based) until the shrink budget runs out. */
  function drain(sender: MessageSender, msgId: number, bytes: Uint8Array, attempt: number): void {
    let noProgress = 0

    for (;;) {
      if (!pending || pending.msgId !== msgId) {
        return
      }

      const r = sender.pump()

      if (r === 'sent') {
        return
      }

      if (r === 'pending') {
        if (++noProgress > MAX_NO_PROGRESS) {
          break
        }
        continue
      }

      if (r === 'retry') {
        setTimeout(() => {
          if (pending && pending.msgId === msgId && sending === sender) {
            drain(sender, msgId, bytes, attempt)
          }
        }, TX_RETRY_MS)
        return
      }

      break
    }

    if (attempt < MAX_SHRINK_RETRIES && sender.currentFragment > KEEB_TLV_FRAG_MIN) {
      transmit(bytes, msgId, Math.max(KEEB_TLV_FRAG_MIN, Math.floor(sender.currentFragment / 2)), attempt + 1)
      return
    }

    abortPending('the keyboard dropped the message')
  }

  /** Restart an in-flight message from offset 0 after the link shrank. */
  function resend(msgId: number): void {
    if (!pending || pending.msgId !== msgId || !transport.value) {
      return
    }

    transmit(pending.bytes, msgId, transport.value.maxFragment, 0)
  }

  function abortPending(reason: string): void {
    if (!pending) {
      return
    }

    clearTimeout(pending.timer)
    pending.reject(new Error(reason))
    pending = null
    sending = null

    if (state.value === 'connected') {
      pumpQueue()
    } else {
      while (queue.length) {
        queue.shift()?.reject(new Error(reason))
      }
    }
  }

  /* ---------------------------------------------------------------- replies */

  function onPacket(pkt: Uint8Array): void {
    const fed = receiver.feed(pkt)

    if (fed.kind === 'error') {
      fail(`packet rejected: ${KEEB_ERR_TEXT[fed.err] ?? fed.err}`)
      return
    }

    if (fed.kind !== 'complete') {
      return
    }

    const { records, malformed } = iterateMessage(fed.msg)

    if (malformed) {
      fail('torn record stream')
      return
    }

    if (fed.flags & KEEB_PKT_F_NOTIFY) {
      for (const rec of records) {
        if (rec.type === KEEB_T_NOTIFY) {
          const n = readNotify(rec.value)
          for (const l of eventListeners) {
            l({ event: n.event, seq: n.seq, data: n.data })
          }
        }
      }

      return
    }

    const want = pending

    if (!want || want.msgId !== fed.msgId) {
      /* A reply for a message we already gave up on. Ignoring it is the only
       * safe move: acting on a stale ACK would report a write we no longer
       * know the outcome of. */
      return
    }

    let ack: AckPayload | null = null

    for (const rec of records) {
      if (rec.type === KEEB_T_ACK) {
        ack = readAck(rec.value)
        continue
      }

      want.onRecord?.(rec.type, rec.value)
    }

    clearTimeout(want.timer)
    pending = null
    sending = null

    if (!ack) {
      want.reject(new Error('reply carried no ACK'))
      pumpQueue()

      return
    }

    if (ack.status === KEEB_STATUS_ERR) {
      want.reject(new Error(KEEB_ERR_TEXT[ack.errCode] ?? `error ${ack.errCode}`))
      pumpQueue()

      return
    }

    want.resolve(ack)
    pumpQueue()
  }

  /* ---------------------------------------------------------------- capabilities */

  async function handshake(): Promise<Capabilities> {
    const got: { info?: InfoPayload } = {}

    await request(
      (m) => m.add(KEEB_T_INFO, 0),
      (type, value) => {
        if (type === KEEB_T_INFO) {
          got.info = readInfo(value)
        }
      },
    )

    if (!got.info) {
      throw new Error('INFO reply carried no INFO record')
    }

    info.value = got.info
    tokenTableMatches.value = got.info.tokenHash === localTokenHash && got.info.proto === 1

    const listed = await fetchTokens()

    tokens.value = listed

    return { info: got.info, tokens: listed, tokenTableMatches: tokenTableMatches.value }
  }

  /** TOKENS is paginated by `next` so the host never has to guess sizes. */
  async function fetchTokens(): Promise<TokenRecord[]> {
    const out: TokenRecord[] = []
    let start = 0

    for (let page = 0; page < 16; page++) {
      let next = 0xffff
      let hash = 0
      let headerSeen = false

      await request(
        (m) => m.addFields(KEEB_T_TOKENS, [start], [2]),
        (type, value) => {
          if (type !== KEEB_T_TOKENS) {
            return
          }

          /* The listing is `one header, then the tokens`. Length cannot tell
           * them apart — a two-character token name ('la') makes an 8-byte
           * record, the same size as the header — so position is the rule. */
          if (!headerSeen) {
            const hdr = readTokensHeader(value)

            next = hdr.next
            hash = hdr.tokenHash
            headerSeen = true
            return
          }

          out.push(readTokenRec(value))
        },
      )

      if (hash !== localTokenHash) {
        tokenTableMatches.value = false
      }

      if (next === 0xffff) {
        break
      }

      start = next
    }

    return out
  }

  async function ping(): Promise<AckPayload> {
    return request((m) => m.add(KEEB_T_PING, 0))
  }

  /* ---------------------------------------------------------------- keymap ops */

  async function readLayerCells(layerId: number, onCells: (p: ReturnType<typeof decodeCells>) => void): Promise<void> {
    await request(
      (m) => m.addFields(KEEB_T_CELLS_GET, [layerId], [1]),
      (type, value) => {
        if (type === KEEB_T_CELLS) {
          onCells(decodeCells(value))
        }
      },
    )
  }

  async function writeCells(layerId: number, cells: Array<{ pos: number } & Binding>): Promise<AckPayload> {
    return request((m) => {
      const dv = m.add(KEEB_T_CELLS_SET, 4 + cells.length * 16)

      if (!dv) {
        return
      }

      dv.setUint8(0, layerId & 0xff)
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
    })
  }

  async function readLayers(): Promise<LayersPayload> {
    let payload: LayersPayload | null = null

    await request(
      (m) => m.add(KEEB_T_LAYERS_GET, 0),
      (type, value) => {
        if (type === KEEB_T_LAYERS) {
          payload = decodeLayers(value)
        } else if (type === KEEB_T_LAYER_NAME_SET && payload) {
          const n = readLayerName(value)
          payload.names[n.layer] = n.name
        }
      },
    )

    if (!payload) {
      throw new Error('LAYERS reply had no LAYERS record')
    }

    return payload
  }

  const renameLayer = (layerId: number, name: string) =>
    request((m) => {
      writeLayerName(m, layerId, name)
    })

  const moveLayer = (from: number, to: number) =>
    request((m) => m.addFields(KEEB_T_LAYER_MOVE, [from, to], [1, 1]))

  const addLayer = () => request((m) => m.add(KEEB_T_LAYER_ADD, 0))

  const removeLayer = (index: number) => request((m) => m.addFields(KEEB_T_LAYER_REMOVE, [index], [1]))

  const restoreLayer = (id: number, index: number) =>
    request((m) => m.addFields(KEEB_T_LAYER_RESTORE, [id, index], [1, 1]))

  const save = () => request((m) => m.add(KEEB_T_SAVE, 0))
  const discard = () => request((m) => m.add(KEEB_T_DISCARD, 0))
  const reset = () => request((m) => m.add(KEEB_T_RESET, 0))

  async function readTokenParams(token: number): Promise<ParamValue[]> {
    if (token === KEEB_TOKEN_NONE || token === KEEB_TOKEN_UNKNOWN) {
      return []
    }

    const out: ParamValue[] = []

    await request(
      (m) => m.addFields(KEEB_T_TOKEN_PARAMS, [token], [2]),
      (type, value) => {
        if (type === KEEB_T_TOKEN_PARAMS) {
          out.push(readParamValue(value))
        }
      },
    )

    return out
  }

  return {
    transport, kind, state, label, info, tokens, readyTokens, tokenTableMatches, lastError, statusLine,
    connected, writable, localTokenHash,
    connectMock, connectBle, disconnect, handshake, ping, fetchTokens,
    readLayerCells, writeCells, readLayers, renameLayer, moveLayer, addLayer, removeLayer, restoreLayer,
    save, discard, reset, readTokenParams,
    onEvent,
  }
})
