/*
 * The settings page against the simulated keyboard.
 *
 * What is being checked is the part that is easy to get wrong when the model is
 * the firmware's (keeb_settings.c): the page shows the keyboard's values rather
 * than its own, an edit is live but not persisted, and DISCARD means "back to
 * the build" rather than "back to what I had saved".
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createPinia, setActivePinia } from 'pinia'

import {
  KEEB_SETTINGS_B_BLANK_ON_IDLE,
  KEEB_SETTINGS_F_ALL,
  KEEB_SETTINGS_F_LED_COLOR_RED,
  KEEB_SETTINGS_F_SLEEP_TIMEOUT,
  KEEB_SETTINGS_SIZE,
  KEEB_T_SETTINGS_SET,
} from '../src/proto/constants.ts'
import { TlvMessage, iterateMessage, readSettings, writeSettingsSet } from '../src/proto/tlv.ts'
import { useDeviceStore } from '../src/stores/device.ts'
import { LAYER_CAPACITY } from '../src/proto/zmk.gen.ts'
import { SETTING_FIELDS, humanMs, useSettingsStore } from '../src/stores/settings.ts'
import { MockKeyboard } from '../src/transport/mockKeyboard.ts'

function fresh() {
  setActivePinia(createPinia())

  return { device: useDeviceStore(), settings: useSettingsStore() }
}

async function loaded() {
  const { device, settings } = fresh()

  await device.connectMock()
  await device.handshake()
  await settings.load()

  return { device, settings }
}

const mockOf = (device: ReturnType<typeof useDeviceStore>) =>
  device.transport as unknown as MockKeyboard

const row = (settings: ReturnType<typeof useSettingsStore>, key: string) =>
  settings.items.find((it) => it.field.key === key)!

test('the rows are the keyboard\'s values, not a local table', async () => {
  const { settings } = await loaded()

  assert.equal(settings.supported, true)
  assert.equal(settings.loaded, true)
  assert.equal(settings.lastError, '')
  /* 13 + one color per keymap layer (the layer color table). */
  assert.equal(SETTING_FIELDS.length, 13 + LAYER_CAPACITY, 'only what the firmware exposes is a row')

  const sleep = row(settings, 'sleepTimeoutMs')

  assert.equal(sleep.field.config, 'CONFIG_ZMK_IDLE_SLEEP_TIMEOUT')
  /* CONFIG_ZMK_IDLE_SLEEP_TIMEOUT, as keeb_left.conf / keeb_right.conf set it. */
  assert.equal(sleep.value, 900000)
  assert.equal(sleep.hint, '15 min')
  assert.equal(settings.dirty, false)

  const color = row(settings, 'ledColorGreen')

  assert.equal(color.value, 0x00ff00)
  assert.equal(color.hint, '#00ff00')
})

test('an edit is staged here, live on the keyboard only after apply', async () => {
  const { device, settings } = await loaded()

  settings.set('sleepTimeoutMs', 60000)

  assert.equal(settings.dirty, true)
  assert.equal(mockOf(device).settingsLive().sleepTimeoutMs, 900000, 'the keyboard has not been told yet')

  const r = await settings.apply()

  assert.equal(r.ok, true)
  assert.equal(mockOf(device).settingsLive().sleepTimeoutMs, 60000)
  /* The store re-reads the record, so what the page shows afterwards is the
   * keyboard's answer rather than what was typed. */
  assert.equal(row(settings, 'sleepTimeoutMs').value, 60000)
  assert.equal(row(settings, 'idleTimeoutMs').value, 30000, 'the other row is untouched')
  assert.equal(settings.dirty, false)
  assert.equal(settings.savedAt, '', 'a live change is not a saved one')
})

test('save is what survives a reboot, and it refuses unsaved edits', async () => {
  const { device, settings } = await loaded()

  settings.set('sleepTimeoutMs', 120000)
  assert.equal((await settings.save()).ok, false, 'nothing applied yet, so there is nothing to persist')

  assert.equal((await settings.apply()).ok, true)
  assert.equal(mockOf(device).settingsSavedToFlash, false)

  assert.equal((await settings.save()).ok, true)
  assert.equal(mockOf(device).settingsSavedToFlash, true)
  assert.match(settings.savedAt, /\d/)
  assert.match(settings.statusLine, /saved to flash/)
})

test('discard puts the compiled-in values back, not the saved ones', async () => {
  const { device, settings } = await loaded()

  settings.set('sleepTimeoutMs', 120000)
  await settings.apply()
  await settings.save()

  settings.set('sleepTimeoutMs', 300000)
  await settings.apply()

  assert.equal((await settings.discard()).ok, true)
  assert.equal(row(settings, 'sleepTimeoutMs').value, 900000, 'back to CONFIG_ZMK_IDLE_SLEEP_TIMEOUT')
  assert.equal(mockOf(device).settingsLive().sleepTimeoutMs, 900000)
  assert.equal(mockOf(device).settingsSavedToFlash, false, 'the saved copy is deleted too')
})

test('a value the keyboard could not undo is refused before it is sent', async () => {
  const { settings } = await loaded()

  settings.set('sleepTimeoutMs', 0)

  assert.equal(settings.problems.length, 1)
  assert.match(settings.problems[0], /deep sleep timeout/)
  assert.equal((await settings.apply()).ok, false)
  assert.equal(settings.lastError, settings.problems[0])

  settings.set('sleepTimeoutMs', 'abc')
  assert.equal(settings.problems.length, 1, 'a non-number is a problem, not a zero')
})

test('the LED palette is a row and is updated through the relay', async () => {
  const { device, settings } = await loaded()

  settings.set('ledColorRed', 0x0000aa) // a red warning turned a darker red
  settings.set('ledBrightnessPercent', 35)

  const r = await settings.apply()

  assert.equal(r.ok, true)
  assert.equal(mockOf(device).settingsLive().ledColorRed, 0x0000aa)
  assert.equal(mockOf(device).settingsLive().ledBrightnessPercent, 35)
  assert.equal(row(settings, 'ledColorRed').value, 0x0000aa)
  assert.equal(row(settings, 'ledBrightnessPercent').value, 35)
})

/* The two LED color groups are separate values: the palette (battery error /
 * connected / advertising) and the per-layer colors. Editing one must not move
 * the other, and each has to survive a save and a discard on its own. */
test('layer colors are their own rows, independent of the BLE palette', async () => {
  const { device, settings } = await loaded()

  /* NAV is layer 1: green at boot, and the palette green is a different value. */
  assert.equal(row(settings, 'ledLayerColor1').value, 0x00ff00)
  assert.equal(row(settings, 'ledLayerColor0').value, 0, 'home layer is off at boot')

  settings.set('ledLayerColor1', 0xaa00aa)

  assert.equal((await settings.apply()).ok, true)
  assert.equal(mockOf(device).settingsLive().ledLayerColors[1], 0xaa00aa)
  /* The BLE signals did not move with it. */
  assert.equal(mockOf(device).settingsLive().ledColorGreen, 0x00ff00)
  assert.equal(mockOf(device).settingsLive().ledColorRed, 0xff0000)
  assert.equal(mockOf(device).settingsLive().ledColorBlue, 0x0000ff)

  /* And the other way round: a palette edit leaves the layer table alone. */
  settings.set('ledColorGreen', 0x123456)
  assert.equal((await settings.apply()).ok, true)
  assert.equal(mockOf(device).settingsLive().ledLayerColors[1], 0xaa00aa)

  assert.equal((await settings.discard()).ok, true)
  assert.equal(row(settings, 'ledLayerColor1').value, 0x00ff00, 'back to the compiled-in layer color')
  assert.equal(row(settings, 'ledColorGreen').value, 0x00ff00)
})

test('a boolean setting flips and applies over the wire', async () => {
  const { device, settings } = await loaded()

  /* blank-on-idle starts on; turn it off. */
  assert.equal(row(settings, 'blankOnIdle').value, true)

  settings.set('blankOnIdle', 0)
  assert.equal(row(settings, 'blankOnIdle').changed, true)

  const r = await settings.apply()

  assert.equal(r.ok, true)
  assert.equal((mockOf(device).settingsLive().booleans & KEEB_SETTINGS_B_BLANK_ON_IDLE), 0)

  settings.set('blankOnIdle', 1)
  await settings.apply()
  assert.equal((mockOf(device).settingsLive().booleans & KEEB_SETTINGS_B_BLANK_ON_IDLE), KEEB_SETTINGS_B_BLANK_ON_IDLE)
})

test('the record on the wire is the struct the firmware writes', () => {
  const msg = new TlvMessage()

  assert.equal(
    writeSettingsSet(msg, {
      flags: KEEB_SETTINGS_F_SLEEP_TIMEOUT | KEEB_SETTINGS_F_LED_COLOR_RED,
      sleepTimeoutMs: 900000,
      ledColorRed: 0x00ff00,
    }),
    true,
  )

  const { records } = iterateMessage(msg.bytes())

  assert.equal(records.length, 1)
  assert.equal(records[0].type, KEEB_T_SETTINGS_SET)
  assert.equal(records[0].value.length, KEEB_SETTINGS_SIZE)

  const got = readSettings(records[0].value)

  assert.equal(got.sleepTimeoutMs, 900000)
  assert.equal(got.ledColorRed, 0x00ff00)
  assert.equal((got.flags & KEEB_SETTINGS_F_ALL), (KEEB_SETTINGS_F_SLEEP_TIMEOUT | KEEB_SETTINGS_F_LED_COLOR_RED))
  assert.equal(got.idleTimeoutMs, 0, 'an un-flagged field is left alone')
  assert.equal(humanMs(90000), '1 min 30 s')
})