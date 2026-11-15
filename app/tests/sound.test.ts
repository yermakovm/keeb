/*
 * The sound page against the simulated keyboard.
 *
 * Three things worth checking, all of them the firmware's model rather than
 * this page's preference:
 *
 *   1. the page shows what the keyboard holds (keeb_sound.c's RAM), so a GET is
 *      the source of truth and a tune edit is not a local table;
 *   2. Apply is RAM and Save is flash — an applied sound plays from the next
 *      press but dies with a reboot; DISCARD means back to the compiled-in
 *      shapes, not back to the last save;
 *   3. the shape validation is the driver's: one bad step refuses the whole
 *      tune, and a preview plays what the page shows without dirtying it.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createPinia, setActivePinia } from 'pinia'

import {
  KEEB_INFO_F_SOUND,
  KEEB_SND_LAYER_ON,
  KEEB_SND_UPDATE_OK,
} from '../src/proto/constants.ts'
import { useDeviceStore } from '../src/stores/device.ts'
import { SOUND_EVENTS, TUNE_NAMES, useSoundStore } from '../src/stores/sound.ts'
import { MockKeyboard } from '../src/transport/mockKeyboard.ts'

function fresh() {
  setActivePinia(createPinia())

  return { device: useDeviceStore(), sound: useSoundStore() }
}

async function loaded() {
  const { device, sound } = fresh()

  await device.connectMock()
  await device.handshake()
  await sound.load()

  return { device, sound }
}

const mockOf = (device: ReturnType<typeof useDeviceStore>) =>
  device.transport as unknown as MockKeyboard

const card = (sound: ReturnType<typeof useSoundStore>, id: number) =>
  sound.tuneCards.find((c) => c.id === id)!

test('the page shows the keyboard\'s tunes and event map', async () => {
  const { device, sound } = await loaded()

  assert.equal(sound.supported, true)
  assert.equal(sound.loaded, true)
  assert.equal(sound.lastError, '')
  assert.equal(sound.dirty, false)
  assert.equal(SOUND_EVENTS.length, 5)
  assert.equal(TUNE_NAMES.length, 7, 'one name per enum zmk_buzzer_tune')

  /* The compiled-in map is identity by meaning: layer_on plays layer_on, ... */
  assert.equal(sound.map[KEEB_SND_LAYER_ON], TUNE_NAMES.indexOf('layer_on'))
  assert.equal(sound.map[KEEB_SND_UPDATE_OK], TUNE_NAMES.indexOf('update_ok'))

  /* update_ok is two rising steps in buzzer/src/buzzer.c. */
  assert.deepEqual(card(sound, TUNE_NAMES.indexOf('update_ok')).steps, [
    { pitchPct: 105, onMs: 55, gapMs: 25 },
    { pitchPct: 125, onMs: 110, gapMs: 0 },
  ])

  assert.ok((device.info!.flags & KEEB_INFO_F_SOUND) !== 0, 'the image advertises the sound channel')
  assert.equal(mockOf(device).soundLive().events[KEEB_SND_LAYER_ON], TUNE_NAMES.indexOf('layer_on'))
})

test('an edit is staged, apply is RAM, save is flash', async () => {
  const { device, sound } = await loaded()
  const mock = mockOf(device)
  const layerOff = TUNE_NAMES.indexOf('layer_off')

  sound.setEvent(KEEB_SND_LAYER_ON, layerOff)
  sound.setStep(layerOff, 0, 'pitchPct', 140)

  assert.equal(sound.dirty, true)
  assert.equal(mock.soundLive().events[KEEB_SND_LAYER_ON], TUNE_NAMES.indexOf('layer_on'), 'not sent yet')

  const applied = await sound.apply()

  assert.equal(applied.ok, true)
  assert.equal(sound.dirty, false)
  assert.equal(sound.savedAt, '')
  assert.equal(mock.soundLive().events[KEEB_SND_LAYER_ON], layerOff)
  assert.equal(mock.soundLive().tunes[layerOff][0].pitchPct, 140)
  assert.equal(mock.settingsSavedToFlash, false, 'apply is not save')

  const saved = await sound.save()

  assert.equal(saved.ok, true)
  assert.equal(mock.settingsSavedToFlash, true)

  /* The page re-reads after a write, so it holds the keyboard's numbers. */
  assert.equal(sound.tuneCards.find((c) => c.id === layerOff)!.steps[0].pitchPct, 140)
})

test('save refuses a staged edit, discard goes back to the build', async () => {
  const { device, sound } = await loaded()

  sound.setEvent(KEEB_SND_UPDATE_OK, TUNE_NAMES.indexOf('wake'))

  assert.equal((await sound.save()).ok, false, 'nothing applied yet')

  assert.equal((await sound.apply()).ok, true)
  assert.equal((await sound.save()).ok, true)

  const discarded = await sound.discard()

  assert.equal(discarded.ok, true)
  assert.equal(sound.dirty, false)
  assert.equal(sound.map[KEEB_SND_UPDATE_OK], TUNE_NAMES.indexOf('update_ok'), 'back to the compiled-in map')
  assert.equal(mockOf(device).settingsSavedToFlash, false)
})

test('one bad step refuses the whole tune, locally and on the board', async () => {
  const { device, sound } = await loaded()
  const ok = TUNE_NAMES.indexOf('update_ok')

  sound.setStep(ok, 1, 'onMs', 5000)

  assert.equal(sound.problems.length, 1)
  assert.equal((await sound.apply()).ok, false, 'the page will not send it')

  /* And the board refuses it too, not just the page: the ACK error is what the
   * session rejects on, and the tune it refused is untouched. */
  const mock = mockOf(device)

  await assert.rejects(
    () => device.writeTune(ok, [{ pitchPct: 100, onMs: 5000, gapMs: 0 }]),
    /out of range/i,
  )

  assert.deepEqual(mock.soundLive().tunes[ok], [
    { pitchPct: 105, onMs: 55, gapMs: 25 },
    { pitchPct: 125, onMs: 110, gapMs: 0 },
  ])
})

test('a preview applies that sound and plays it, without dirtying the page', async () => {
  const { device, sound } = await loaded()
  const mock = mockOf(device)
  const wake = TUNE_NAMES.indexOf('wake')

  sound.setStep(wake, 0, 'onMs', 45)
  assert.equal(sound.dirty, true)

  const heard = await sound.preview(wake)

  assert.equal(heard.ok, true)
  assert.equal(mock.tunePlayed().at(-1), wake)
  assert.equal(mock.soundLive().tunes[wake][0].onMs, 45, 'the preview played the shape on the page')
  assert.equal(sound.tuneCards.find((c) => c.id === wake)!.changed, false, 'that sound is applied now')
  assert.equal(sound.dirty, false)
  assert.equal(mock.settingsSavedToFlash, false)
})
