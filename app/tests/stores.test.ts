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

import { KEYCODES, KEY_COUNT, RESERVED_POSITIONS, STOCK_LAYERS, STOCK_LAYER_NAMES, TOKENS } from '../src/proto/zmk.gen.ts'
import { describeTokenDiff, useDeviceStore } from '../src/stores/device.ts'
import { setTraceEnabled } from '../src/debug/trace.ts'
import { KEEB_EV_CELLS_SET, KEEB_T_ACK, KEEB_T_CELLS_SET, KEEB_T_SAVE } from '../src/proto/constants.ts'
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
  /* The name comes from the firmware's table, not from this test: renaming a
   * display-name in keeb.keymap is a layout decision, not a protocol change.
   */
  assert.equal(keymap.layerName(cell.param1), STOCK_LAYER_NAMES[2])
})

/*
 * Applying and persisting are two firmware operations, and only the second one
 * survives a reboot. The mock models that split: `savedToSettings` is the
 * settings snapshot, and DISCARD returns the keyboard to it.
 */
const persisted = (device: ReturnType<typeof useDeviceStore>): boolean =>
  (device.transport as unknown as { savedToSettings: boolean }).savedToSettings

test('a token-table mismatch names the tokens that disagree', () => {
  /* The mock is the agreeing case: a diff has to stay silent when it is not a
   * problem, or the panel would warn on every connection.
   */
  assert.deepEqual(describeTokenDiff(TOKENS.map((t) => ({ token: t.id, name: t.name })), TOKENS.length, TOKENS), [])

  /* The two failures a person can actually act on: the keyboard moved the
   * table (reflash), and this build moved it (npm run gen).
   */
  const staleImage = TOKENS.slice(0, -1).map((t) => ({ token: t.id, name: t.name }))
  const moved = describeTokenDiff(staleImage, staleImage.length, TOKENS)

  assert.ok(moved.some((d) => /27 tokens, this configurator has 28/.test(d)), moved.join(' | '))
  assert.ok(moved.some((d) => d.includes('right_boot')), moved.join(' | '))

  const renamed = TOKENS.map((t) => ({ token: t.id, name: t.id === 0 ? 'key_toggle' : t.name }))
  const diff = describeTokenDiff(renamed, renamed.length, TOKENS)

  assert.ok(diff.some((d) => d.includes('token 0') && d.includes('key_press') && d.includes('key_toggle')), diff.join(' | '))

  /* No listing is not 28 missing tokens; it is one unknown. */
  const blind = describeTokenDiff([], 27, TOKENS)

  assert.equal(blind.length, 2, blind.join(' | '))
  assert.ok(blind[1].includes('listing was not obtained'), blind.join(' | '))
})

test('the store reports an empty diff while the tables agree', async () => {
  const { device } = await loaded()

  assert.equal(device.tokenTableMatches, true)
  assert.deepEqual(device.tokenTableDiff, [])
})

test('the channel trace logs what was sent and what the keyboard acknowledged', async () => {
  const { device, keymap } = await loaded()

  setTraceEnabled(true)

  const consoleLines: string[] = []
  const realLog = console.log
  const realWarn = console.warn

  console.log = (m?: unknown) => consoleLines.push(String(m))
  console.warn = (m?: unknown) => consoleLines.push(String(m))

  try {
    assert.equal(keymap.setBinding(1, 20, { token: kp, param1: KEYCODES.A, param2: 0 }).ok, true)

    const r = await keymap.commitLayer(1)

    assert.equal(r.ok, true)
  } finally {
    console.log = realLog
    console.warn = realWarn
    setTraceEnabled(false)
  }

  const log = device.traceLog

  const sent = log.find((e) => e.dir === 'tx' && e.types.includes(KEEB_T_CELLS_SET))

  assert.ok(sent, 'the CELLS_SET that went out has to appear in the trace')

  const acked = log.find((e) => e.dir === 'ack' && e.types.includes(KEEB_T_ACK))

  assert.ok(acked, 'the ACK has to be traceable to the message it answers')
  assert.equal(acked.msgId, sent.msgId, 'a trace line that cannot be matched to its request is not a debug aid')
  assert.equal(acked.status, 0)
  assert.equal(acked.detail, 1, 'the applied cell count survives to the trace')

  assert.ok(log.some((e) => e.dir === 'evt' && e.event === KEEB_EV_CELLS_SET), 'the keyboard event is traced too')
  assert.ok(log.some((e) => e.dir === 'tx' && e.types.includes(KEEB_T_SAVE)), 'autosave is visible on the trace')

  assert.ok(consoleLines.every((l) => l.startsWith('keeb tlv')), consoleLines.join('\n'))
  assert.ok(consoleLines.some((l) => /CELLS_SET\(0x1003\)/.test(l)), consoleLines.join('\n'))
})

test('autosave is on, so an applied write is also persisted', async () => {
  const { device, keymap } = await loaded()

  assert.equal(keymap.autosave, true)
  assert.equal(persisted(device), false)

  assert.equal(keymap.setBinding(1, 12, { token: kp, param1: KEYCODES.A, param2: 0 }).ok, true)

  const r = await keymap.commitLayer(1)

  assert.equal(r.ok, true)
  assert.equal(r.applied, 1)
  assert.equal(r.saved, true, 'the write was followed by a SAVE')
  assert.equal(persisted(device), true)
  assert.equal(keymap.hasUnsaved, false)
})

test('autosave off leaves a write live in the keyboard but unpersisted', async () => {
  const { device, keymap } = await loaded()

  keymap.setAutosave(false)

  assert.equal(keymap.setBinding(1, 13, { token: kp, param1: KEYCODES.A, param2: 0 }).ok, true)

  const r = await keymap.commitLayer(1)

  assert.equal(r.ok, true)
  assert.equal(r.saved, false)
  assert.equal(persisted(device), false, 'nothing was written to settings')
  assert.equal(keymap.hasUnsaved, true, 'and the store says so')
  assert.equal(keymap.unsavedWrites, 1)

  /* The keyboard still has the change - a reboot is what drops it. */
  assert.equal(keymap.ownCell(1, 13)?.token, kp)

  const s = await keymap.save()

  assert.equal(s.ok, true)
  assert.equal(persisted(device), true)
  assert.equal(keymap.hasUnsaved, false)
})

test('a layer rename persists like a cell write, and does not without autosave', async () => {
  const original = (await loaded()).keymap.slots[0].name

  const { device, keymap } = await loaded()

  const r = await keymap.renameLayer(0, 'MAIN')

  assert.equal(r.ok, true)
  assert.equal(r.saved, true)
  assert.equal(persisted(device), true)
  assert.equal(keymap.slots[0].name, 'MAIN')

  /* DISCARD returns the keyboard to its settings snapshot, which is the same
   * thing a reboot returns it to: the rename is in that snapshot.
   */
  assert.equal((await keymap.discard()).ok, true)
  assert.equal(keymap.slots[0].name, 'MAIN')

  const manual = await loaded()

  manual.keymap.setAutosave(false)

  assert.equal((await manual.keymap.renameLayer(0, 'MAIN')).ok, true)
  assert.equal(manual.keymap.hasUnsaved, true)
  assert.equal(persisted(manual.device), false)

  await manual.keymap.discard()

  assert.equal(manual.keymap.slots[0].name, original, 'an unsaved rename is gone')
})

test('unstaging one cell brings back the keyboard’s own binding and leaves the rest staged', async () => {
  const { keymap } = await loaded()

  const original = keymap.ownCell(0, 12)!.param1

  keymap.setBinding(0, 12, { token: kp, param1: KEYCODES.B, param2: 0 })
  keymap.setBinding(0, 13, { token: kp, param1: KEYCODES.C, param2: 0 })

  assert.equal(keymap.dirtyTotal, 2)

  const r = await keymap.revertCell(0, 12)

  assert.equal(r.ok, true)
  assert.equal(keymap.dirtyTotal, 1)
  assert.equal(keymap.ownCell(0, 12)?.param1, original, 'the staged value is gone, the keyboard’s is back')
  assert.equal(keymap.ownCell(0, 13)?.param1, KEYCODES.C, 'unstaking one key must not drop the other')
  assert.equal(keymap.isPending(0, 12), false)
  assert.equal(keymap.isPending(0, 13), true)
})

test('unstaging a cell that was never staged is refused', async () => {
  const { keymap } = await loaded()

  const r = await keymap.revertCell(0, 12)

  assert.equal(r.ok, false)
  assert.match(r.reason ?? '', /nothing staged/)
  assert.equal(keymap.dirtyTotal, 0)
})

test('unstaging from an empty slot is refused before anything is reloaded', async () => {
  const { keymap } = await loaded()

  await keymap.removeLayer(1)

  const empty = keymap.slots.findIndex((s) => s.id === LAYER_ID_INVALID)

  assert.notEqual(empty, -1)

  const r = await keymap.revertCell(empty, 12)

  assert.equal(r.ok, false)
  assert.equal(r.reason, 'slot is empty')
})
