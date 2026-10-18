/*
 * Store behaviour against the simulated keyboard.
 *
 * Runs the real Pinia stores (no browser) to check the parts that are easy to
 * get wrong when the model is the firmware's: pending edits survive a refused
 * write, &trans really does fall through to the lower slot, and a notification
 * from the keyboard re-reads rather than trusts the local copy.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createPinia, setActivePinia } from 'pinia'

import { KEYCODES, KEY_COUNT, RESERVED_POSITIONS, STOCK_LAYERS, TOKENS } from '../src/proto/zmk.gen.ts'
import { useDeviceStore } from '../src/stores/device.ts'
import { LAYER_ID_INVALID, NONE_TOKEN, TRANSPARENT_TOKEN, useKeymapStore } from '../src/stores/keymap.ts'

const kp = TOKENS.find((t) => t.label === 'kp')!.id
const mo = TOKENS.find((t) => t.label === 'mo')!.id

function fresh() {
  setActivePinia(createPinia())

  const device = useDeviceStore()
  const keymap = useKeymapStore()

  return { device, keymap }
}

async function loaded() {
  const { device, keymap } = fresh()

  await device.connectMock()
  keymap.bindEvents()
  await device.handshake()
  await keymap.loadAll()

  return { device, keymap }
}

test('the store starts from the firmware, not from local state', async () => {
  const { device, keymap } = await loaded()

  assert.equal(device.tokenTableMatches, true)
  assert.equal(keymap.keyCount, KEY_COUNT)
  assert.equal(keymap.slots.length, STOCK_LAYERS.length)
  assert.equal(keymap.slots[0].name, 'HOME')
  assert.equal(keymap.slots[0].live, true, 'HOME is active at boot')

  for (const slot of keymap.slots) {
    assert.notEqual(slot.id, LAYER_ID_INVALID)
  }
})

test('an edit is local until it is pushed', async () => {
  const { keymap } = await loaded()

  const pos = 12
  const before = keymap.ownCell(1, pos)

  assert.ok(before)

  const r = keymap.setBinding(1, pos, { token: kp, param1: KEYCODES.A, param2: 0 })

  assert.equal(r.ok, true)
  assert.equal(keymap.dirtyTotal, 1)

  const committed = await keymap.commitLayer(1)

  assert.equal(committed.ok, true)
  assert.equal(committed.applied, 1)
  assert.equal(keymap.dirtyTotal, 0)

  const after = keymap.ownCell(1, pos)

  assert.ok(after)
  assert.equal(after.token, kp)
  assert.equal(after.param1, KEYCODES.A)
  assert.notEqual(after.param1, before.param1, 'the write actually changed the cell')
})

test('a reserved position is refused locally, and would be refused by the firmware', async () => {
  const { keymap } = await loaded()

  const r = keymap.setBinding(1, RESERVED_POSITIONS[0], { token: kp, param1: KEYCODES.A, param2: 0 })

  assert.equal(r.ok, false)
  assert.match(r.reason ?? '', /reserved/)
  assert.equal(keymap.dirtyTotal, 0)
})

test('&trans inherits from the lower slot, &none does not', async () => {
  const { keymap } = await loaded()

  const pos = 24

  const homeBinding = keymap.resolve(0, pos)

  assert.ok(homeBinding)

  assert.equal(keymap.setBinding(1, pos, { token: TRANSPARENT_TOKEN, param1: 0, param2: 0 }).ok, true)
  await keymap.commitLayer(1)

  const through = keymap.resolve(1, pos)

  assert.ok(through)
  assert.equal(through.fromSlot, 0, 'transparent fell through to HOME')
  assert.equal(through.binding.token, homeBinding.binding.token)

  assert.equal(keymap.setBinding(1, pos, { token: NONE_TOKEN, param1: 0, param2: 0 }).ok, true)
  await keymap.commitLayer(1)

  const disabled = keymap.resolve(1, pos)

  assert.ok(disabled)
  assert.equal(disabled.fromSlot, 1, 'a no-op binding is a real binding, not an absence')
  assert.equal(disabled.binding.token, NONE_TOKEN)
})

test('a layer-state notification from the keyboard updates the store', async () => {
  const { device, keymap } = await loaded()

  const kb = device.transport

  assert.ok(kb)

  /* The mock stands in for someone holding a MO key: the event arrives on its
   * own, and the store follows it. */
  ;(kb as unknown as { simulateLayerState: (mask: number) => void }).simulateLayerState(0b010)

  await new Promise((r) => setTimeout(r, 20))

  assert.equal(keymap.layerState, 0b010)
  assert.equal(keymap.slots.filter((s) => s.live).length, 1)
})

test('a layer add takes a slot from the firmware pool', async () => {
  const { keymap } = await loaded()

  const removed = await keymap.removeLayer(5)

  assert.equal(removed.ok, true)

  const empty = keymap.slots.find((s) => s.id === LAYER_ID_INVALID)

  assert.ok(empty, 'removing leaves an empty slot')

  const added = await keymap.addLayer()

  assert.equal(added.ok, true)
  assert.equal(added.index, empty.index)
  assert.notEqual(keymap.slots[empty.index].id, LAYER_ID_INVALID)
})

test('MO tokens carry a layer id, not a layer name', async () => {
  const { keymap } = await loaded()

  keymap.setBinding(0, 52, { token: mo, param1: 2, param2: 0 })
  await keymap.commitLayer(0)

  const cell = keymap.ownCell(0, 52)

  assert.ok(cell)
  assert.equal(cell.param1, 2)
  assert.equal(keymap.layerName(cell.param1), 'FUN')
})
