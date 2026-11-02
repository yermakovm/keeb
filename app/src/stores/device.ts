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

import { clearTrace, onTrace, trace } from '../debug/trace.ts'
import type { TraceEntry } from '../debug/trace.ts'

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
  KEEB_T_DISPLAY,
  KEEB_T_DISPLAY_BLANK,
  KEEB_T_DISPLAY_DISCARD,
  KEEB_T_DISPLAY_GET,
  KEEB_T_DISPLAY_INFO,
  KEEB_T_DISPLAY_RESET,
  KEEB_T_DISPLAY_SAVE,
  KEEB_T_PRESET_NAME,
  KEEB_T_PRESET_SET,
  KEEB_T_TEXT_SET,
  KEEB_T_VALUE_SET,
  KEEB_T_TEST_SET,
  KEEB_T_TOKENS,
  KEEB_TOKEN_F_READY,
  KEEB_STATUS_OK,
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
  readDisplayHeader,
  readDisplayInfo as decodeDisplayInfo,
  readDisplayWidgets,
  readInfo,
  readLayerName,
  readLayers as decodeLayers,
  readNotify,
  readParamValue,
  readPresetName,
  readTextSlot,
  readTokenRec,
  readTokensHeader,
  readValueSlot,
  tokenTableHash,
  writeDisplayTable,
  writeLayerName,
  writeTextSlot,
  writeValueSlot,
  writeWidgetSet,
} from '../proto/tlv.ts'
import { TOKENS } from '../proto/zmk.gen.ts'
import type {
  AckPayload,
  Binding,
  Capabilities,
  DisplayInfoPayload,
  DisplayTablePayload,
  InfoPayload,
  LayersPayload,
  ParamValue,
  PresetName,
  TokenRecord,
  Widget,
} from '../proto/types.ts'
import { BleTransport, forgetGrants } from '../transport/ble.ts'
/* Test double, not a device: MockKeyboard is what the codec, session and store
 * tests (and the SSR smoke render) speak to. The app itself only ever talks to
 * a real keyboard. */
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

/**
 * Explain a token-table mismatch instead of only announcing it.
 *
 * The hash check can tell that two tables disagree; it cannot tell which side is
 * stale. The keyboard's own listing arrives in the same handshake, so the
 * disagreement can be named: a renamed or added behavior in the devicetree, and
 * an image that predates this contract, look different, and the fixes
 * (re-run `npm run gen` vs. rebuild and reflash) are opposites.
 *
 * Names here are the firmware's device names (`key_press`), which is what the
 * hash is computed over; `&label` is only shown as the form a person recognises.
 */
export function describeTokenDiff(
  deviceTokens: Array<{ token: number; name: string }>,
  deviceCount: number,
  localTokens: Array<{ id: number; name: string; label: string }>,
  limit = 8,
): string[] {
  const out: string[] = []

  if (deviceCount !== localTokens.length) {
    out.push(`the keyboard has ${deviceCount} tokens, this configurator has ${localTokens.length}`)
  }

  /* No listing to compare against: the count line is the whole honest answer,
   * and naming 28 missing tokens would read as 28 separate problems.
   */
  if (deviceTokens.length === 0) {
    out.push('the keyboard’s token listing was not obtained, so the difference cannot be pinned to a token')
    return out
  }

  const deviceById = new Map(deviceTokens.map((t) => [t.token, t.name]))
  const localNames = new Set(localTokens.map((t) => t.name))

  for (const t of localTokens) {
    const deviceName = deviceById.get(t.id)

    if (deviceName === undefined) {
      out.push(`token ${t.id} (&${t.label}) is not in the keyboard's table`)
      continue
    }

    if (deviceName !== t.name) {
      out.push(`token ${t.id}: keyboard "${deviceName}" vs configurator "${t.name}" (&${t.label})`)
    }
  }

  for (const t of deviceTokens) {
    if (!localNames.has(t.name)) {
      out.push(`the keyboard has token ${t.token} ("${t.name}") this configurator does not know`)
    }
  }

  return out.slice(0, limit)
}

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

  /* Channel trace: what left this host, what the keyboard acknowledged, and what
   * it volunteered as an event. The console gets every line; this is the same
   * history kept for anything that wants to render it.
   */
  const traceLog = ref<TraceEntry[]>([])

  function clearTraceLog(): void {
    clearTrace()
    traceLog.value = []
  }

  const connected = computed(() => state.value === 'connected')

  /** True when the connected keyboard's token table is the one this UI was
   * generated from. Writes are refused without it. */
  const writable = computed(() => connected.value && info.value !== null && tokenTableMatches.value)

  const readyTokens = computed(() => tokens.value.filter((t) => (t.flags & KEEB_TOKEN_F_READY) !== 0))

  /** What actually disagrees, when the handshake says the tables differ.
   * Empty while the tables agree or before a handshake, so a UI can show it
   * unconditionally.
   */
  const tokenTableDiff = computed<string[]>(() =>
    tokenTableMatches.value || !info.value
      ? []
      : describeTokenDiff(tokens.value, info.value.tokenCount, TOKENS),
  )

  function onEvent(cb: (e: DeviceEvent) => void): () => void {
    eventListeners.add(cb)

    return () => eventListeners.delete(cb)
  }

  function fail(message: string): void {
    lastError.value = message
    statusLine.value = message
  }

  /* ---------------------------------------------------------------- session */

  async function attach(
    t: KeebTransport,
    as: TransportKind,
    open: (t: KeebTransport) => Promise<unknown> = (x) => x.connect(),
  ): Promise<void> {
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
      onTrace((e) => {
        traceLog.value.push(e)

        if (traceLog.value.length > 200) {
          traceLog.value.shift()
        }
      }),
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

    /* Opened through the caller: the chooser path, or the gesture-free
     * reconnect to a saved grant. The label is only known afterwards, and a
     * reconnect that found nothing must not leave a label behind.
     */
    await open(t)
    label.value = t.state === 'connected' ? t.label : ''
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
    label.value = ''
    info.value = null
    tokens.value = []
    tokenTableMatches.value = false
    testMode.value = false
  }

  /** Test-only: attach the simulated keyboard. Nothing in the UI calls this;
   * it exists so the protocol and the stores stay testable without hardware.
   */
  async function connectMock(): Promise<void> {
    await attach(new MockKeyboard(), 'mock')
  }

  /** `all` opens the chooser with every BLE device in range, for when the
   * advertised name is not the one the generated contract expects.
   */
  async function connectBle(all = false): Promise<void> {
    await attach(new BleTransport(), 'ble', (t) => (t as BleTransport).connect({ all }))
  }

  /** Restore the session without asking anyone to click: reconnect to a device
   * this browser was already granted, which is the one Web Bluetooth path that
   * needs no user gesture.
   *
   * Returns the keyboard label, or null when nothing saved is reachable - the
   * keyboard is off, asleep, or holding another host's profile. That is a normal
   * load-time state, so the transport is detached again and the status line keeps
   * whatever the transport said about why. The answer is the Bluetooth… button.
   */
  async function reconnectBle(): Promise<string | null> {
    const t = new BleTransport()

    await attach(t, 'ble', () => t.connectSaved())

    if (t.state !== 'connected') {
      detach()
      return null
    }

    return t.label
  }

  /** Revoke this browser's Bluetooth grants for this origin. Chrome keeps them
   * across reloads and across a firmware flash, and stale entries are what make
   * the chooser offer a device that can never connect.
   */
  async function forgetBle(): Promise<number> {
    const t = transport.value

    if (t instanceof BleTransport) {
      return t.forget()
    }

    return forgetGrants()
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

  /** Record types a built message carries, for the trace line. Reading the
   * finished bytes rather than the builder calls is what keeps the trace honest
   * about a message that a builder helper quietly truncated.
   */
  function messageTypes(bytes: Uint8Array): number[] {
    return iterateMessage(bytes).records.map((r) => r.type)
  }

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

    trace('tx', msgId, { types: messageTypes(bytes), bytes: bytes.length })

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
    trace('err', pending.msgId, { note: reason })
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
      trace('err', -1, { note: `packet rejected: ${KEEB_ERR_TEXT[fed.err] ?? fed.err}` })
      fail(`packet rejected: ${KEEB_ERR_TEXT[fed.err] ?? fed.err}`)
      return
    }

    if (fed.kind !== 'complete') {
      return
    }

    const { records, malformed } = iterateMessage(fed.msg)

    if (malformed) {
      trace('err', fed.msgId, { note: 'torn record stream', bytes: fed.msg.length })
      fail('torn record stream')
      return
    }

    const types = records.map((r) => r.type)

    if (fed.flags & KEEB_PKT_F_NOTIFY) {
      for (const rec of records) {
        if (rec.type === KEEB_T_NOTIFY) {
          const n = readNotify(rec.value)

          trace('evt', fed.msgId, { event: n.event, seq: n.seq, bytes: n.data.length })

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
       * know the outcome of. It is still worth a trace line - this is the
       * signature of a link that is slower than the request timeout.
       */
      trace('err', fed.msgId, { types, bytes: fed.msg.length, note: 'reply for a message already given up on' })
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

    trace('ack', fed.msgId, {
      types,
      bytes: fed.msg.length,
      status: ack ? ack.status : undefined,
      err: ack?.errCode,
      detail: ack?.detail,
      note: ack ? undefined : 'reply carried no ACK',
    })

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

  /* ---------------------------------------------------------------- tester mode
   *
   * Key events are a mode, not a subscription: a keyboard that streamed every
   * keystroke would couple its typing to a Bluetooth link it does not need. So
   * the configurator asks for them when the tester is open and stops asking
   * when it closes, and the keyboard answers with the mode it actually ended up
   * in rather than trusting the request. */

  const testMode = ref(false)

  async function setTestMode(on: boolean): Promise<boolean> {
    if (state.value !== 'connected') {
      testMode.value = false
      return false
    }

    const ack = await request((m) => m.addFields(KEEB_T_TEST_SET, [on ? 1 : 0], [1]))

    testMode.value = ack.status === KEEB_STATUS_OK && ack.detail === 1

    return testMode.value
  }

  /** Press a switch on the simulated keyboard. Only the mock has switches to
   * press; on real hardware the finger does it and this returns false. */
  function mockKey(pos: number, pressed: boolean, layer = 0): boolean {
    if (kind.value !== 'mock') {
      return false
    }

    const t = transport.value as MockKeyboard | null

    if (!t || typeof t.simulateKey !== 'function') {
      return false
    }

    t.simulateKey(pos, pressed, layer)

    return true
  }

  /* ---------------------------------------------------------------- display ops
   *
   * The panel is a table of drawing primitives the firmware paints from ZMK's
   * own state, so these reads and writes never move a value - they move a
   * readout. The limits come from DISPLAY_INFO rather than from a table the UI
   * was generated with, because the panel is not in devicetree. */

  async function readDisplayInfo(): Promise<{ info: DisplayInfoPayload; presets: PresetName[] }> {
    let got: DisplayInfoPayload | null = null
    const presets: PresetName[] = []

    await request(
      (m) => m.add(KEEB_T_DISPLAY_INFO, 0),
      (type, value) => {
        if (type === KEEB_T_DISPLAY_INFO) {
          got = decodeDisplayInfo(value)
        } else if (type === KEEB_T_PRESET_NAME) {
          presets.push(readPresetName(value))
        }
      },
    )

    if (!got) {
      throw new Error('DISPLAY_INFO reply had no DISPLAY_INFO record')
    }

    return { info: got, presets }
  }

  async function readDisplay(): Promise<DisplayTablePayload> {
    let table: DisplayTablePayload | null = null

    await request(
      (m) => m.add(KEEB_T_DISPLAY_GET, 0),
      (type, value) => {
        if (type === KEEB_T_DISPLAY) {
          const hdr = readDisplayHeader(value)

          table = { ...hdr, widgets: readDisplayWidgets(value), texts: {}, values: {} }
        } else if (type === KEEB_T_TEXT_SET && table) {
          const slot = readTextSlot(value)

          table.texts[slot.slot] = slot.text
        } else if (type === KEEB_T_VALUE_SET && table) {
          const slot = readValueSlot(value)

          table.values[slot.slot] = slot.value
        }
      },
    )

    if (!table) {
      throw new Error('DISPLAY reply had no DISPLAY record')
    }

    return table
  }

  const writeDisplay = (widgets: Widget[]) =>
    request((m) => {
      writeDisplayTable(m, widgets)
    })

  const writeWidget = (index: number, w: Widget) =>
    request((m) => {
      writeWidgetSet(m, index, w)
    })

  const writeText = (slot: number, text: string) =>
    request((m) => {
      writeTextSlot(m, slot, text)
    })

  const writeValue = (slot: number, value: number) =>
    request((m) => {
      writeValueSlot(m, slot, value)
    })

  const applyPreset = (preset: number) =>
    request((m) => {
      const dv = m.add(KEEB_T_PRESET_SET, 2)

      if (dv) {
        dv.setUint8(0, preset & 0xff)
        dv.setUint8(1, 0)
      }
    })

  const displaySave = () => request((m) => m.add(KEEB_T_DISPLAY_SAVE, 0))
  const displayDiscard = () => request((m) => m.add(KEEB_T_DISPLAY_DISCARD, 0))
  const displayReset = () => request((m) => m.add(KEEB_T_DISPLAY_RESET, 0))
  const displayBlank = () => request((m) => m.add(KEEB_T_DISPLAY_BLANK, 0))

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
    connected, writable, localTokenHash, tokenTableDiff,
    connectMock, connectBle, reconnectBle, forgetBle, disconnect, handshake, ping, fetchTokens,
    readLayerCells, writeCells, readLayers, renameLayer, moveLayer, addLayer, removeLayer, restoreLayer,
    save, discard, reset, readTokenParams,
    testMode, setTestMode, mockKey,
    readDisplayInfo, readDisplay, writeDisplay, writeWidget, writeText, writeValue, applyPreset,
    displaySave, displayDiscard, displayReset, displayBlank,
    traceLog, clearTraceLog,
    onEvent,
  }
})
