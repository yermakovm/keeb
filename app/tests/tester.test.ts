/*
 * The tester: mode gating, event decoding, and what the log keeps.
 *
 * The point of these tests is the boundary between "the keyboard is telling me
 * about every switch" and "it is not". A tester that left the request in place
 * would keep a keyboard streaming keystrokes after the screen that asked for
 * them is closed, and a tester that reported a press as a release is worse than
 * no tester at all.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createPinia, setActivePinia } from 'pinia'

import { KEY_COUNT } from '../src/proto/zmk.gen.ts'
import { useDeviceStore } from '../src/stores/device.ts'
import { useKeymapStore } from '../src/stores/keymap.ts'
import { useTesterStore } from '../src/stores/tester.ts'

function fresh() {
  setActivePinia(createPinia())

  const device = useDeviceStore()
  const keymap = useKeymapStore()
  const tester = useTesterStore()

  return { device, keymap, tester }
}

async function attached() {
  const stores = fresh()

  await stores.device.connectMock()
  await stores.device.handshake()
  await stores.keymap.loadAll()

  return stores
}

test('the keyboard answers with the tester mode it actually ended up in', async () => {
  const { device } = await attached()

  assert.equal(await device.setTestMode(true), true)
  assert.equal(device.testMode, true)

  assert.equal(await device.setTestMode(false), false)
  assert.equal(device.testMode, false)
})

test('a switch is only reported while the keyboard is in tester mode', async () => {
  const { device, tester } = await attached()

  await tester.open()

  assert.equal(device.mockKey(7, true, 0), true)
  assert.equal(tester.events.length, 1)
  assert.equal(tester.events[0].pos, 7)
  assert.equal(tester.events[0].pressed, true)
  assert.equal(tester.events[0].layer, 0)

  await tester.close()

  // The same press now produces nothing: the mode is off, so the keyboard has
  // no reason to send it and the mock does not.
  assert.equal(device.mockKey(7, true, 0), true)
  assert.equal(tester.events.length, 1)
})

test('a closed switch stays reported as closed until it opens', async () => {
  const { device, tester } = await attached()

  await tester.open()

  device.mockKey(12, true, 0)
  assert.equal(tester.held.has(12), true)
  assert.equal(tester.pressCount, 1)
  assert.equal(tester.releaseCount, 0)

  device.mockKey(12, false, 0)
  assert.equal(tester.held.has(12), false)
  assert.equal(tester.releaseCount, 1)
  assert.equal(tester.events.length, 2)

  await tester.close()
})

test('the log is a ring: the newest report is first and the old ones fall off', async () => {
  const { device, tester } = await attached()

  await tester.open()

  for (let i = 0; i < tester.MAX_EVENTS + 30; i++) {
    device.mockKey(i % KEY_COUNT, true, 0)
    device.mockKey(i % KEY_COUNT, false, 0)
  }

  assert.equal(tester.events.length, tester.MAX_EVENTS)
  assert.equal(tester.events[0].pressed, false)

  await tester.close()
})

test('a position that never closed is named as never reported', async () => {
  const { device, tester } = await attached()

  await tester.open()

  device.mockKey(3, true, 0)
  device.mockKey(4, true, 0)

  assert.equal(tester.seen.size, 2)
  assert.equal(tester.neverPressed.length, KEY_COUNT - 2)
  assert.equal(tester.neverPressed.includes(3), false)
  assert.equal(tester.coverage, `2/${KEY_COUNT} positions reported`)

  tester.clear()
  assert.equal(tester.events.length, 0)
  assert.equal(tester.neverPressed.length, KEY_COUNT)

  await tester.close()
})

test('a disconnect leaves the keyboard out of tester mode', async () => {
  const { device, tester } = await attached()

  await tester.open()
  assert.equal(device.testMode, true)

  device.disconnect()
  assert.equal(device.testMode, false)
})
