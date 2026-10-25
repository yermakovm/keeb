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
 *      starts at the firmware's own budget - MTU 65, minus 3 for the ATT opcode
 *      and handle, minus the 16 byte KEEB header that travels inside every
 *      fragment - and shrinks only when a write actually reports a size
 *      problem, which is the KEEB_TX_MTU path the codec already implements. If
 *      the link cannot carry even KEEB_TLV_FRAG_MIN the honest answer is an
 *      error: halving further is not a recovery, and the firmware refuses to do
 *      it for the same reason.
 *
 *   3. Only the objects that really are EventTargets get listeners. Per the
 *      spec, BluetoothRemoteGATTServer has no events at all; `gattserverdisconnected`
 *      is fired on the BluetoothDevice, and `characteristicvaluechanged` on the
 *      characteristic. A link drop has to be caught on the device or it is
 *      invisible: the transport would keep a `connected` state over a dead link.
 *
 *   4. Only `requestDevice()` needs a user gesture. `getDevices()` does not, so
 *      a page load can restore the session on its own by reconnecting to a
 *      device this origin was already granted (connectSaved). That is also the
 *      only way to avoid asking for a chooser every reload.
 *
 * Web Bluetooth types are declared locally rather than pulled in as a
 * @types package: only a handful of members are used, and a local declaration
 * keeps the dependency list unchanged.
 */

import { KEEB_BLE_FRAG_PAYLOAD, KEEB_CMD_UUID, KEEB_EVT_UUID, KEEB_PKT_HDR_SIZE, KEEB_SVC_UUID, KEEB_TLV_FRAG_MIN, KEEB_TX_BUSY, KEEB_TX_FAIL, KEEB_TX_MTU } from '../proto/constants.ts'
import { KEYBOARD_NAME } from '../proto/zmk.gen.ts'
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

/** Not an EventTarget: no events, only connect/disconnect/service discovery. */
interface GattServer {
  getPrimaryService(uuid: string): Promise<GattService>
  disconnect(): void
}

/** BluetoothDevice *is* an EventTarget, and it is the only one that reports a
 * dropped GATT link (`gattserverdisconnected`). */
interface BleDevice {
  readonly name: string
  readonly gatt: { connect(): Promise<GattServer> }
  addEventListener(type: string, handler: () => void): void
  removeEventListener(type: string, handler: () => void): void
  /** Revokes this origin's permission to see the device at all. */
  forget?(): Promise<void>
}

interface BluetoothLike {
  /** Needs a user gesture in Chrome. */
  requestDevice(options: unknown): Promise<BleDevice>
  /** Devices this origin was already granted: no gesture required, which is
   * what makes reconnecting on page load possible. */
  getDevices?(): Promise<BleDevice[]>
}

const MAX_QUEUED_PACKETS = 32

/* Web Bluetooth reports BLE failures as bare strings with no code and no
 * stage. The strings below are the ones a ZMK peripheral actually produces,
 * each with the thing that has to change on the keyboard or in the OS - a
 * "connect BLE: Unsupported device" line that does not say which step failed
 * is not debuggable.
 */
const BLE_HINTS: Array<[RegExp, string]> = [
  [/unsupported device/i, 'the adapter refuses that entry outright. Usual causes here: the keyboard is already paired with or connected to the OS (macOS Bluetooth settings - forget it), the chooser is showing a stale entry, or the entry is the peripheral half - only the central half can take a configurator link (ZMK gives the peripheral BT_MAX_CONN 1, and its one link is the split).'],
  [/not paired/i, 'the browser cannot pair this device itself; unpair it in the OS and let the keyboard pair with the browser.'],
  [/not found|no device|not allowed/i, `no device matched. Usually one of: the keyboard is not advertising (ZMK stops advertising while its active profile is connected - press BT_SEL on an open profile, or BT_CLR to clear one), it is asleep, or it advertises a different name than "${KEYBOARD_NAME}" (renamed in config/keeb.conf without re-running npm run gen). "Show all devices" widens the chooser.`],
  [/gatt error|operation failed|invalid state/i, 'the link was refused or dropped. Two causes look identical here: another host is holding the keyboard (or its profile is taken), or the keyboard was reset and no longer trusts this browser - if the second fits, use "re-pair".'],
  [/insufficient authentication|insufficient encryption|not authenticated|authentication is required|encryption/i, 'the link cannot be encrypted: the keyboard no longer holds a bond with this browser. That is what a keyboard-side reset looks like from here - BT_CLR, cleared bonds, or a reflash. Use "re-pair" (forget and choose again in one click); on macOS also forget the keyboard in Bluetooth settings if the OS holds it.'],
  [/user gesture|transient activation|security error|not allowed to request/i, 'the chooser needs a fresh click: the browser consumed the user activation before requestDevice() ran. Press the button again - do not chain it behind another async step.'],
]

function describeError(label: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const hint = BLE_HINTS.find(([re]) => re.test(msg))

  return `${label}: ${msg}${hint ? ` - ${hint[1]}` : ''}`
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/* A saved grant that cannot complete a link because the *keyboard* no longer
 * recognises this browser: only an authentication, encryption or pairing failure
 * says that. A GATT error says a link was refused, which a busy keyboard says
 * too, so treating it as a stale grant would make the app forget a good bond
 * over a keyboard that is merely asleep or held by another host.
 */
const STALE_GRANT = /insufficient authentication|insufficient encryption|not authenticated|authentication is required|not paired|no bond/i

/** Clear every Bluetooth grant this browser holds for this origin.
 *
 * Chrome keeps granted devices across reloads *and* across a firmware flash,
 * and it still lists them in the chooser when they are not advertising. A stale
 * entry is not cosmetic: selecting it is one of the ways "Unsupported device"
 * happens, and after a re-flash the old bond is stale on both sides. Web
 * Bluetooth has no way to remove one entry from the chooser, so the honest
 * action is to forget them and let the next connection start clean.
 */
export async function forgetGrants(one?: BleDevice | null): Promise<number> {
  const bluetooth = (globalThis.navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth
  const stale = new Set<BleDevice>()

  if (one) {
    stale.add(one)
  }

  if (bluetooth?.getDevices) {
    for (const device of await bluetooth.getDevices()) {
      stale.add(device)
    }
  }

  let forgotten = 0

  for (const device of stale) {
    if (!device.forget) {
      continue
    }

    try {
      await device.forget()
      forgotten += 1
    } catch {
      /* already gone, or this browser does not implement forget() */
    }
  }

  return forgotten
}

export class BleTransport implements KeebTransport {
  label = 'BLE'
  maxFragment = KEEB_BLE_FRAG_PAYLOAD
  state: TransportState = 'offline'

  private device: BleDevice | null = null
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

  /** The device's `gattserverdisconnected` handler, kept as one reference so
   * it can be removed again (requestDevice may hand back the same device). */
  private onLinkClosed = (): void => {
    this.server = null
    this.cmd = null
    this.queue = []
    this.setState('offline', 'disconnected')
  }

  private listenToLink(): void {
    this.device?.addEventListener('gattserverdisconnected', this.onLinkClosed)
  }

  private unlistenToLink(): void {
    this.device?.removeEventListener('gattserverdisconnected', this.onLinkClosed)
  }

  /** One labelled step of the handshake. Naming the step is the difference
   * between "connect BLE: Unsupported device" and a message that says whether
   * the chooser, the GATT link, or the service lookup failed.
   */
  private async stage<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      throw new Error(describeError(label, err))
    }
  }

  private bluetooth(): BluetoothLike {
    const nav = (globalThis.navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth

    if (!nav) {
      throw new Error('Web Bluetooth is unavailable in this browser')
    }

    return nav
  }

  private closeDevice(): void {
    /* A half-open device would keep firing events into a transport that is no
     * longer using it.
     */
    this.unlistenToLink()
    this.device = null
    this.server = null
    this.cmd = null
    this.queue = []
  }

  /** Everything after "we have a device object": link, service, the two
   * characteristics, the subscription. Shared by the chooser path and the
   * gesture-free reconnect so both report the same steps.
   */
  private async openDevice(device: BleDevice, action: string): Promise<void> {
    this.label = device.name || 'keeb'
    this.device = device

    /* Before connect(): a link that drops during service discovery has to be
     * reported too.
     */
    this.listenToLink()

    this.setState('connecting', `${action} ${this.label}`)

    const server = await this.stage('GATT connect', () => device.gatt.connect())

    this.setState('connecting', 'looking for the KEEB service')

    const service = await this.stage('KEEB service', () => server.getPrimaryService(KEEB_SVC_UUID))
    const cmd = await this.stage('cmd characteristic', () => service.getCharacteristic(KEEB_CMD_UUID))
    const evt = await this.stage('evt characteristic', () => service.getCharacteristic(KEEB_EVT_UUID))

    await this.stage('subscribe to notifications', async () => {
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
    })

    this.server = server
    this.cmd = cmd
    this.setState('connected', this.label)
  }

  /** Chooser path. Chrome requires a user gesture for this one.
   *
   * The filter is the advertised name, which the generator reads from
   * CONFIG_ZMK_KEYBOARD_NAME. Filtering by the HID service is not an option:
   * 0x1812 is on the Web Bluetooth GATT blocklist, and a blocklisted service in
   * `filters` is a SecurityError rather than a narrower list. The KEEB service
   * is never advertised, so it belongs in `optionalServices`, which is what
   * makes getPrimaryService(KEEB_SVC_UUID) legal after a name-filtered connect.
   *
   * `all` is the escape hatch: every BLE device in range, for when the name the
   * browser sees is not the name the contract expects.
   */
  async connect(opts: { all?: boolean } = {}): Promise<void> {
    try {
      const bluetooth = this.bluetooth()

      this.setState('connecting', 'choose a keyboard')

      const device = await this.stage('choose device', () =>
        bluetooth.requestDevice(
          opts.all
            ? { acceptAllDevices: true, optionalServices: [KEEB_SVC_UUID] }
            : { filters: [{ name: KEYBOARD_NAME }], optionalServices: [KEEB_SVC_UUID] },
        ),
      )

      await this.openDevice(device, 'connecting to')
    } catch (err) {
      this.closeDevice()
      this.setState('error', messageOf(err))
      throw err
    }
  }

  /** Reconnect without a chooser.
   *
   * `getDevices()` is the one Web Bluetooth call that needs no user gesture, so
   * it is the only way a page load can restore the session by itself: a device
   * this origin was already granted can be connected directly. Returns the
   * device label, or null when nothing saved is reachable - null rather than a
   * throw, because a failed auto-reconnect at load is a normal state (the
   * keyboard is off, asleep, or on another host's profile) and the answer is a
   * button, not a stack trace.
   */
  async connectSaved(): Promise<string | null> {
    let bluetooth: BluetoothLike

    try {
      bluetooth = this.bluetooth()
    } catch (err) {
      this.setState('error', messageOf(err))
      return null
    }

    if (!bluetooth.getDevices) {
      this.setState('error', 'this browser cannot list saved Bluetooth devices')
      return null
    }

    let saved: BleDevice[] = []

    try {
      saved = await bluetooth.getDevices()
    } catch (err) {
      this.setState('error', describeError('saved devices', err))
      return null
    }

    if (!saved.length) {
      this.setState('offline', 'no keyboard saved by this browser - press Connect')
      return null
    }

    let last = ''

    for (const device of saved) {
      try {
        await this.openDevice(device, 'reconnecting to')
        return this.label
      } catch (err) {
        this.closeDevice()
        last = messageOf(err)
      }
    }

    this.setState(
      'offline',
      STALE_GRANT.test(last)
        ? `saved keyboard refused the link (${last}) - it no longer has a bond with this browser: use re-pair`
        : `saved keyboard unreachable (${last}) - press Connect`,
    )
    return null
  }

  /** Forget this browser's saved grants (see forgetGrants). */
  async forget(): Promise<number> {
    const device = this.device
    const forgotten = await forgetGrants(device)

    this.disconnect()

    return forgotten
  }


  disconnect(): void {
    this.queue = []
    this.unlistenToLink()

    if (this.server) {
      try {
        this.server.disconnect()
      } catch {
        /* already gone */
      }
    }

    this.server = null
    this.cmd = null
    this.device = null
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
           * tell the sender to restart it from offset 0.
           */
          if (this.maxFragment <= KEEB_TLV_FRAG_MIN) {
            /* Already at the floor: this link cannot carry a KEEB packet, and
             * retrying the same fragment is what turns a keyboard's log into
             * "No buffer available to send notification" forever.
             */
            this.queue = []
            this.draining = false
            this.setState('error', `link MTU cannot carry a ${KEEB_PKT_HDR_SIZE + KEEB_TLV_FRAG_MIN} byte packet`)
            return
          }

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
