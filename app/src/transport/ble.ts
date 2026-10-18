/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Web Bluetooth adapter for the KEEB TLV channel.
 *
 * Mirrors keeb-module/transport/keeb_ble.c:
 *   service  4b454542-0000-0001-…  vendor service
 *   cmd      4b454542-0000-0002-…  write without response, host -> keyboard
 *   evt      4b454542-0000-0003-…  notify, keyboard -> host
 *
 * Two things this transport has to hide from the codec:
 *
 *   1. Web Bluetooth writes are async, the codec's send hook is not. Packets
 *      go into a queue that drains one write at a time, because the protocol
 *      requires fragments to arrive in order. The queue is bounded, and a full
 *      queue answers KEEB_TX_BUSY — the same answer Zephyr's empty TX pool
 *      gets, and the codec's answer is the same: keep the message and retry.
 *   2. Web Bluetooth does not expose the negotiated MTU. The fragment size
 *      starts at the firmware's own budget (MTU 65 - 3 = 62) and shrinks only
 *      when a write actually reports a size problem, which is the KEEB_TX_MTU
 *      path the codec already implements.
 *
 * Web Bluetooth types are declared locally rather than pulled in as a
 * @types package: only a handful of members are used, and a local declaration
 * keeps the dependency list unchanged.
 */

import { KEEB_CMD_UUID, KEEB_EVT_UUID, KEEB_PKT_HDR_SIZE, KEEB_SVC_UUID, KEEB_TLV_FRAG_MIN, KEEB_TX_BUSY, KEEB_TX_FAIL, KEEB_TX_MTU } from '../proto/constants.ts'
import type { KeebTransport, TransportState } from './types.ts'

interface GattProperties {
  write?: boolean
  writeWithoutResponse?: boolean
  notify?: boolean
}

interface GattCharacteristic {
  readonly uuid: string
  readonly properties: GattProperties
  writeValueWithoutResponse(value: DataView): Promise<unknown>
  writeValue(value: DataView): Promise<unknown>
  startNotifications(): Promise<GattCharacteristic>
  addEventListener(type: string, handler: (ev: { target: { value?: DataView } }) => void): void
}

interface GattService {
  getCharacteristic(uuid: string): Promise<GattCharacteristic>
}

interface GattServer {
  getPrimaryService(uuid: string): Promise<GattService>
  disconnect(): void
  addEventListener(type: string, handler: () => void): void
}

interface BleDevice {
  readonly name: string
  readonly gatt: { connect(): Promise<GattServer> }
}

interface BluetoothLike {
  requestDevice(options: unknown): Promise<BleDevice>
}

const MAX_QUEUED_PACKETS = 32

/** The firmware's notification budget: CONFIG_BT_L2CAP_TX_MTU (65) - 3. */
const FRAG_PAYLOAD = 62

export class BleTransport implements KeebTransport {
  label = 'BLE'
  maxFragment = FRAG_PAYLOAD
  state: TransportState = 'offline'

  private server: GattServer | null = null
  private cmd: GattCharacteristic | null = null
  private queue: Uint8Array[] = []
  private draining = false
  private packetHandlers = new Set<(pkt: Uint8Array) => void>()
  private stateHandlers = new Set<(s: TransportState, detail: string) => void>()
  private shrinkHandlers = new Set<(maxFragment: number) => void>()

  private setState(state: TransportState, detail = ''): void {
    this.state = state

    for (const h of this.stateHandlers) {
      h(state, detail)
    }
  }

  async connect(): Promise<void> {
    const nav = (globalThis.navigator as unknown as { bluetooth?: BluetoothLike })

    if (!nav.bluetooth) {
      this.setState('error', 'Web Bluetooth is unavailable in this browser')
      throw new Error('Web Bluetooth is unavailable in this browser')
    }

    this.setState('connecting', 'choose a keyboard')

    try {
      /* The keyboard advertises as CONFIG_ZMK_KEYBOARD_NAME ("keeb"), but a
       * name filter would break as soon as that name changes, and the service
       * UUID is the honest filter: only keyboards with the TLV channel appear. */
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [KEEB_SVC_UUID],
      })

      this.label = device.name || 'keeb'

      const server = await device.gatt.connect()

      server.addEventListener('advertisementdisconnected', () => this.setState('offline', 'link dropped'))
      server.addEventListener('gattserverdisconnected', () => {
        this.cmd = null
            this.server = null
        this.queue = []
        this.setState('offline', 'disconnected')
      })

      const service = await server.getPrimaryService(KEEB_SVC_UUID)
      const cmd = await service.getCharacteristic(KEEB_CMD_UUID)
      const evt = await service.getCharacteristic(KEEB_EVT_UUID)

      await evt.startNotifications()
      evt.addEventListener('characteristicvaluechanged', (ev) => {
        const value = ev.target.value

        if (!value) {
          return
        }

        const pkt = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)

        for (const h of this.packetHandlers) {
          h(pkt)
        }
      })

      this.server = server
      this.cmd = cmd
      this.setState('connected', this.label)
    } catch (err) {
      this.setState('error', err instanceof Error ? err.message : String(err))
      throw err
    }
  }

  disconnect(): void {
    this.queue = []

    if (this.server) {
      try {
        this.server.disconnect()
      } catch {
        /* already gone */
      }
    }

    this.server = null
    this.cmd = null
    this.setState('offline', 'disconnected')
  }

  /** Queue a packet and keep the writes sequential: the receiver's reassembly
   * rejects out-of-order fragments, so a racing write is a lost message. */
  send = (pkt: Uint8Array): number => {
    if (!this.cmd) {
      return KEEB_TX_FAIL
    }

    /* Known-too-large is answered synchronously, so the codec shrinks the
     * fragment and re-sends the same offset instead of waiting for a write
     * that would fail. */
    if (pkt.length - KEEB_PKT_HDR_SIZE > this.maxFragment) {
      return KEEB_TX_MTU
    }

    if (this.queue.length >= MAX_QUEUED_PACKETS) {
      return KEEB_TX_BUSY
    }

    this.queue.push(pkt)
    void this.drain()

    return 0
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return
    }

    this.draining = true

    while (this.queue.length && this.cmd) {
      const pkt = this.queue[0]

      try {
        await this.cmd.writeValueWithoutResponse(new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength))
        this.queue.shift()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)

        if (/too large|invalid|size/i.test(msg)) {
          /* The negotiated MTU is smaller than this transport assumed. Nothing
           * can be salvaged from a half-sent message, so shrink the link and
           * tell the sender to restart it from offset 0. */
          this.queue = []
          this.draining = false
          this.maxFragment = Math.max(KEEB_TLV_FRAG_MIN, Math.floor(this.maxFragment / 2))

          for (const h of this.shrinkHandlers) {
            h(this.maxFragment)
          }

          return
        }

        this.queue = []
        this.draining = false
        this.setState('error', `write failed: ${msg}`)
        return
      }
    }

    this.draining = false
  }

  onPacket(handler: (pkt: Uint8Array) => void): () => void {
    this.packetHandlers.add(handler)

    return () => this.packetHandlers.delete(handler)
  }

  onState(handler: (state: TransportState, detail: string) => void): () => void {
    this.stateHandlers.add(handler)

    return () => this.stateHandlers.delete(handler)
  }

  onShrink(handler: (maxFragment: number) => void): () => void {
    this.shrinkHandlers.add(handler)

    return () => this.shrinkHandlers.delete(handler)
  }
}
