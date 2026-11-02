/*
 * The log panel's store: the same lines the browser console gets, kept in the
 * page.
 *
 * The point of the store is that it is a second reader of the transport's own
 * trace, not a channel the transport has to be told about. So the test drives
 * the real mock transport and checks that the panel would have shown what the
 * console showed.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createPinia, setActivePinia } from 'pinia'

import { clearTrace, setTraceEnabled, trace } from '../src/debug/trace.ts'
import { KEEB_T_CELLS_SET, KEEB_T_SAVE } from '../src/proto/constants.ts'
import { KEYCODES, TOKENS } from '../src/proto/zmk.gen.ts'
import { useDeviceStore } from '../src/stores/device.ts'
import { useKeymapStore } from '../src/stores/keymap.ts'
import { useLogStore } from '../src/stores/log.ts'

const kp = TOKENS.find((t) => t.label === 'kp')!.id

function fresh() {
  setActivePinia(createPinia())
  clearTrace()

  return {
    device: useDeviceStore(),
    keymap: useKeymapStore(),
    log: useLogStore(),
  }
}

test('the log mirrors the transport trace, in the order it happened', async () => {
  setTraceEnabled(true)

  const { device, keymap, log } = fresh()

  await device.connectMock()
  keymap.bindEvents()
  await device.handshake()
  await keymap.loadAll()

  log.attach()

  keymap.setBinding(0, 12, { token: kp, param1: KEYCODES.A, param2: 0 })

  const commit = await keymap.commitLayer(0)

  assert.equal(commit.ok, true)

  const lines = log.lines.map((l) => l.line)

  assert.ok(
    lines.some((l) => l.includes('CELLS_SET')),
    'the message that went out has to be in the panel',
  )
  assert.ok(
    lines.some((l) => l.includes('ACK')),
    'the answer has to be in the panel',
  )
  assert.ok(
    lines.some((l) => l.includes('CELLS_SET')) && log.lines.some((l) => l.kind === 'tx'),
    'a direction is part of the line, not something the reader has to guess',
  )

  const tx = log.lines.findIndex((l) => l.kind === 'tx' && l.line.includes('CELLS_SET'))
  const ack = log.lines.findIndex((l, i) => i > tx && l.kind === 'ack' && l.msgId === log.lines[tx].msgId)

  assert.ok(tx >= 0 && ack > tx, 'a reply is logged after the request it answers')
  assert.ok(
    log.lines[ack].line.includes('OK'),
    'the panel shows the answer the keyboard gave, not just that something came back',
  )

  log.detach()
})

test('attach() backfills what already happened, and does not do it twice', async () => {
  setTraceEnabled(true)

  const { device, log } = fresh()

  await device.connectMock()
  await device.handshake()
  await device.handshake()

  log.attach()
  const first = log.lines.length

  assert.ok(first > 0, 'the handshake already produced lines before the panel attached')

  log.attach()

  assert.equal(log.lines.length, first, 'a second attach must not duplicate the backlog')

  log.detach()
})

test('a line the configurator says out loud is logged as ui, not as traffic', () => {
  const { log } = fresh()

  log.note('applied 3 cell(s)')

  const line = log.lines.at(-1)!

  assert.equal(line.kind, 'ui')
  assert.equal(line.line, 'applied 3 cell(s)')
  assert.equal(line.msgId, -1, 'a line the configurator said answers no request')
})

test('an error is counted so the button can show it while closed', () => {
  const { log } = fresh()

  log.note('read failed', 'err')
  log.note('read again', 'ui')

  assert.equal(log.errors, 1)
})

test('the ring holds the recent end, not the whole session', () => {
  const { log } = fresh()

  for (let i = 0; i < 500; i++) {
    log.note(`line ${i}`)
  }

  assert.equal(log.lines.length, 400)
  assert.equal(log.lines[0].line, 'line 100', 'the oldest 100 lines are the ones that go')
  assert.equal(log.lines.at(-1)!.line, 'line 499')
})

test('clear empties the panel and the trace it reads from', () => {
  setTraceEnabled(true)

  const { log } = fresh()

  trace('tx', 7, { types: [KEEB_T_CELLS_SET, KEEB_T_SAVE] })
  log.note('noise')
  log.attach()
  log.clear()

  assert.equal(log.lines.length, 0)
})
