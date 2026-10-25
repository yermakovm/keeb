/*
 * Web Bluetooth adapter against a fake navigator.bluetooth.
 *
 * The fake mirrors the spec's object model, which is the part that matters:
 * BluetoothRemoteGATTServer is NOT an EventTarget (it has no events at all),
 * while BluetoothDevice fires `gattserverdisconnected` and
 * BluetoothRemoteGATTCharacteristic fires `characteristicvaluechanged`.
 * Attaching a listener to the server is a TypeError in a real browser, i.e.
 * connect() fails before the service is ever looked up.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { KEEB_ATT_OVERHEAD, KEEB_BLE_ATT_MTU, KEEB_CMD_UUID, KEEB_EVT_UUID, KEEB_HID_SERVICE_UUID_BLOCKLISTED, KEEB_PKT_HDR_SIZE, KEEB_SVC_UUID, KEEB_TX_FAIL } from '../src/proto/constants.ts'
import { KEYBOARD_NAME } from '../src/proto/zmk.gen.ts'
import { BleTransport, forgetGrants } from '../src/transport/ble.ts'

class FakeCharacteristic {
  properties = { writeWithoutResponse: true, notify: true }
  notificationsStarted = false
  writes: Uint8Array[] = []

  private handlers = new Map<string, Array<(ev: { target: { value?: DataView } }) => void>>()

  addEventListener(type: string, handler: (ev: { target: { value?: DataView } }) => void): void {
    const list = this.handlers.get(type) ?? []
    list.push(handler)
    this.handlers.set(type, list)
  }

  startNotifications(): Promise<FakeCharacteristic> {
    this.notificationsStarted = true
    return Promise.resolve(this)
  }

  /** What the keyboard would push on the notify characteristic. */
  emit(bytes: Uint8Array): void {
    for (const h of this.handlers.get('characteristicvaluechanged') ?? []) {
      h({ target: { value: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) } })
    }
  }

  writeValueWithoutResponse(value: DataView): Promise<unknown> {
    this.writes.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    return Promise.resolve()
  }
}

class FakeService {
  private chars: Map<string, FakeCharacteristic>

  constructor(chars: Map<string, FakeCharacteristic>) {
    this.chars = chars
  }

  getCharacteristic(uuid: string): Promise<FakeCharacteristic> {
    const c = this.chars.get(uuid)
    if (!c) {
      return Promise.reject(new Error(`no characteristic ${uuid}`))
    }
    return Promise.resolve(c)
  }
}

/** Deliberately has no addEventListener: neither does the real one. */
class FakeServer {
  disconnected = false
  primaryError = ''
  private service: FakeService

  constructor(service: FakeService) {
    this.service = service
  }

  getPrimaryService(uuid: string): Promise<FakeService> {
    if (this.primaryError) {
      return Promise.reject(new Error(this.primaryError))
    }

    if (uuid !== KEEB_SVC_UUID) {
      return Promise.reject(new Error(`no service ${uuid}`))
    }

    return Promise.resolve(this.service)
  }

  disconnect(): void {
    this.disconnected = true
  }
}

class FakeDevice {
  readonly name = 'keeb'
  readonly gatt = { connect: async () => this.server }

  listeners: Array<{ type: string; handler: () => void }> = []
  forgotten = false

  cmd = new FakeCharacteristic()
  evt = new FakeCharacteristic()
  server = new FakeServer(new FakeService(new Map([[KEEB_CMD_UUID, this.cmd], [KEEB_EVT_UUID, this.evt]])))

  addEventListener(type: string, handler: () => void): void {
    this.listeners.push({ type, handler })
  }

  removeEventListener(type: string, handler: () => void): void {
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.handler === handler))
  }

  forget(): Promise<void> {
    this.forgotten = true
    return Promise.resolve()
  }

  /** The browser's `gattserverdisconnected`, i.e. the only link-drop signal. */
  dropLink(): void {
    for (const l of this.listeners.filter((l) => l.type === 'gattserverdisconnected')) {
      l.handler()
    }
  }

  listenerCount(type: string): number {
    return this.listeners.filter((l) => l.type === type).length
  }
}

/* What the fake browser knows about this origin: the device the chooser would
 * hand back, and the devices already granted (getDevices). */
interface FakeBrowser {
  device: FakeDevice
  saved: FakeDevice[]
  chooserRequests(): number
  chooserOptions(): Record<string, unknown> | null
}

async function withFakeBluetooth<T>(
  fn: (device: FakeDevice, browser: FakeBrowser) => Promise<T>,
  opts: { requestError?: string; serviceError?: string; saved?: FakeDevice[] } = {},
): Promise<T> {
  const navigator = globalThis.navigator
  const device = new FakeDevice()
  const saved = opts.saved ?? [device]
  let chooser = 0
  let options: Record<string, unknown> | null = null

  if (opts.serviceError) {
    device.server.primaryError = opts.serviceError
  }

  Object.defineProperty(globalThis, 'navigator', {
    value: {
      bluetooth: {
        requestDevice: async (o?: unknown) => {
          chooser += 1
          options = (o as Record<string, unknown>) ?? null

          if (opts.requestError) {
            throw new Error(opts.requestError)
          }

          return device
        },
        /* Devices this origin was already granted: the gesture-free path. */
        getDevices: async () => saved,
      },
    },
    configurable: true,
    writable: true,
  })

  try {
    return await fn(device, {
      device,
      saved,
      chooserRequests: () => chooser,
      chooserOptions: () => options,
    })
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      value: navigator,
      configurable: true,
      writable: true,
    })
  }
}

test('a fragment plus its KEEB header fits the keyboard ATT MTU', () => {
  const t = new BleTransport()
  const pkt = KEEB_PKT_HDR_SIZE + t.maxFragment

  /* The failure this guards: budgeting the MTU as if the 16 byte KEEB header
   * were not inside the notification payload. The keyboard then builds a PDU the
   * peer's MTU cannot carry, Zephyr answers it as -ENOMEM ("No buffer available
   * to send notification"), and the codec re-sends the same oversized fragment
   * on every retry - a host that never gets an ACK.
   */
  assert.ok(pkt + KEEB_ATT_OVERHEAD <= KEEB_BLE_ATT_MTU,
    `packet ${pkt} + ${KEEB_ATT_OVERHEAD} ATT must fit MTU ${KEEB_BLE_ATT_MTU}`)
})

test('BLE connect completes against a GATT server that has no events', async () => {
  await withFakeBluetooth(async (device) => {
    const t = new BleTransport()
    const seen: Array<{ state: string; detail: string }> = []

    t.onState((state, detail) => seen.push({ state, detail }))

    await t.connect()

    assert.equal(t.state, 'connected')
    assert.equal(device.server.disconnected, false)
    assert.equal(device.evt.notificationsStarted, true, 'notify must be enabled before the handshake starts')
    assert.equal(t.label, 'keeb')
    assert.equal(seen[0].state, 'connecting')
    assert.equal(seen[seen.length - 1].state, 'connected')
    assert.ok(seen.every((s) => s.state === 'connecting' || s.state === 'connected'),
      'the handshake reports progress, not a jump straight to connected')
  })
})

test('a chooser failure names the step and says what to change', async () => {
  await withFakeBluetooth(
    async () => {
      const t = new BleTransport()
      const seen: Array<{ state: string; detail: string }> = []

      t.onState((state, detail) => seen.push({ state, detail }))

      const err = await t.connect().then(() => null, (e: unknown) => e as Error)

      assert.ok(err, 'connect must reject, not resolve into a half-open link')
      assert.match(err.message, /choose device: Unsupported device/)
      assert.match(err.message, /paired with/, 'the message has to carry the fix, not just the browser string')
      assert.match(err.message, /central half/, 'the peripheral half can never answer, so the message has to say so')
      assert.equal(t.state, 'error')
      assert.equal(seen[seen.length - 1].state, 'error')
      assert.equal(seen[seen.length - 1].detail, err.message)
    },
    { requestError: 'Unsupported device' },
  )
})

test('a service lookup failure is not reported as a chooser failure', async () => {
  await withFakeBluetooth(
    async () => {
      const t = new BleTransport()

      await assert.rejects(() => t.connect(), /KEEB service: GATT Error: Unknown/)
      assert.equal(t.state, 'error')
    },
    { serviceError: 'GATT Error: Unknown' },
  )
})

test('a link drop is observed through the device, not the server', async () => {
  await withFakeBluetooth(async (device) => {
    const t = new BleTransport()
    const packets: Uint8Array[] = []

    t.onPacket((p) => packets.push(p))
    await t.connect()

    assert.equal(device.listenerCount('gattserverdisconnected'), 1)

    device.evt.emit(new Uint8Array([1, 2, 3]))
    assert.equal(packets.length, 1)

    device.dropLink()

    assert.equal(t.state, 'offline')
    assert.equal(device.cmd.writes.length, 0)
    assert.equal(t.send(new Uint8Array([0])), KEEB_TX_FAIL, 'a dropped link must not queue writes')
  })
})

test('disconnect removes the device listener so reconnects do not stack them', async () => {
  await withFakeBluetooth(async (device) => {
    const t = new BleTransport()

    await t.connect()
    t.disconnect()

    assert.equal(device.server.disconnected, true)
    assert.equal(device.listenerCount('gattserverdisconnected'), 0)
    assert.equal(t.state, 'offline')

    await t.connect()
    assert.equal(device.listenerCount('gattserverdisconnected'), 1)
    assert.equal(t.state, 'connected')

    t.disconnect()
  })
})

test('the chooser filters on the advertised name from the firmware config', async () => {
  await withFakeBluetooth(async (_device, browser) => {
    const t = new BleTransport()

    await t.connect()

    const options = browser.chooserOptions()

    assert.ok(options, 'requestDevice must be called with options')
    assert.equal(options.acceptAllDevices, undefined, 'acceptAllDevices would list every BLE device in range')
    /* The name is what ZMK actually puts on the air (BT_LE_ADV_OPT_USE_NAME |
     * FORCE_NAME_IN_AD), and it comes from config/keeb.conf through the
     * generator, so renaming the keyboard cannot leave the UI filtering for a
     * name that no longer exists. */
    assert.deepEqual(options.filters, [{ name: KEYBOARD_NAME }])
    /* A name filter grants no service access. Without optionalServices the
     * connect succeeds and getPrimaryService then fails with "Not allowed", i.e.
     * a keyboard that connects and answers nothing. */
    assert.deepEqual(options.optionalServices, [KEEB_SVC_UUID])

    t.disconnect()
  })
})

test('no chooser path filters by a service: 0x1812 is blocklisted, not narrowing', async () => {
  /* ZMK advertises 0x1812 HID + 0x180F Battery, so the HID service looks like
   * the obvious filter for "only keyboards". It is on the Web Bluetooth GATT
   * blocklist ("direct access to HID devices would let web pages become
   * keyloggers"), and a blocklisted service in filters is a SecurityError: the
   * chooser shows nothing, which looks exactly like a keyboard that is not
   * advertising. Both chooser paths must therefore stay service-free. */
  assert.match(KEEB_HID_SERVICE_UUID_BLOCKLISTED, /^00001812-/)

  await withFakeBluetooth(async (_device, browser) => {
    const t = new BleTransport()

    await t.connect()
    assert.deepEqual(browser.chooserOptions()?.filters, [{ name: KEYBOARD_NAME }])

    t.disconnect()

    await t.connect({ all: true })

    const wide = browser.chooserOptions()

    assert.equal(wide?.acceptAllDevices, true)
    assert.equal(wide?.filters, undefined, 'the fallback widens the chooser, it does not re-filter by service')
    assert.deepEqual(wide?.optionalServices, [KEEB_SVC_UUID])

    t.disconnect()
  })
})

test('a page load reconnects to a saved grant without opening the chooser', async () => {
  await withFakeBluetooth(async (device, browser) => {
    const t = new BleTransport()

    assert.equal(await t.connectSaved(), 'keeb')
    assert.equal(t.state, 'connected')
    assert.equal(browser.chooserRequests(), 0, 'getDevices needs no user gesture; the chooser must stay closed')
    assert.equal(device.cmd.notificationsStarted || device.evt.notificationsStarted, true)

    t.disconnect()
  })
})

test('nothing saved is a state with a button, not an exception', async () => {
  await withFakeBluetooth(async () => {
    const t = new BleTransport()
    const states: Array<{ state: string; detail: string }> = []

    t.onState((state, detail) => states.push({ state, detail }))

    assert.equal(await t.connectSaved(), null)
    assert.equal(t.state, 'offline')
    assert.match(states[states.length - 1].detail, /no keyboard saved/)
  }, { saved: [] })
})

test('a saved keyboard that will not answer ends offline with the reason it refused', async () => {
  const asleep = new FakeDevice()

  asleep.server.primaryError = 'GATT Error: Operation failed.'

  await withFakeBluetooth(async (_device, browser) => {
    const t = new BleTransport()
    const states: Array<{ state: string; detail: string }> = []

    t.onState((state, detail) => states.push({ state, detail }))

    assert.equal(await t.connectSaved(), null)
    assert.equal(t.state, 'offline')
    assert.equal(browser.chooserRequests(), 0)

    const last = states[states.length - 1]

    assert.match(last.detail, /unreachable/)
    assert.match(last.detail, /Operation failed/, 'the reason the keyboard refused has to survive to the UI')
    assert.equal(asleep.listenerCount('gattserverdisconnected'), 0, 'a device this transport failed to open must not keep listeners')
  }, { saved: [asleep] })
})

test('a keyboard that no longer trusts this browser is named as a pairing problem', async () => {
  const reset = new FakeDevice()

  /* What the GATT layer reports when the keyboard's side of the bond is gone:
   * the cmd characteristic is writable only on an encrypted link
   * (keeb_ble.c), and the keyboard cleared its bonds (BT_CLR, a reset, a
   * reflash) while Chrome kept its grant.
   */
  reset.server.primaryError = 'GATT Error: Insufficient authentication.'

  await withFakeBluetooth(async () => {
    const t = new BleTransport()
    const states: Array<{ state: string; detail: string }> = []

    t.onState((state, detail) => states.push({ state, detail }))

    assert.equal(await t.connectSaved(), null)

    const last = states[states.length - 1]

    assert.match(last.detail, /no longer has a bond with this browser/, last.detail)
    assert.match(last.detail, /re-pair/, 'the message has to name the action that fixes it')
  }, { saved: [reset] })
})

test('forget revokes every grant this browser holds, not only the connected one', async () => {
  const stale = new FakeDevice()

  await withFakeBluetooth(async (device) => {
    const t = new BleTransport()

    await t.connect()

    /* The chooser device plus everything getDevices still lists: a stale entry
     * is what makes the next connect fail with "Unsupported device". */
    assert.equal(await t.forget(), 2)
    assert.equal(device.forgotten, true)
    assert.equal(stale.forgotten, true)
    assert.equal(t.state, 'offline')
  }, { saved: [stale] })
})

test('forgetGrants works with no transport attached', async () => {
  await withFakeBluetooth(async (device, browser) => {
    assert.equal(await forgetGrants(), browser.saved.length)
    assert.equal(device.forgotten, true)
  })
})
