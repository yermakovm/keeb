/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Sound page — what the buzzer plays, and which event plays it.
 *
 * The model is the firmware's (buzzer/src/buzzer.c + keeb-module/settings/
 * keeb_sound.c): a boot copies the compiled-in tune shapes into RAM, TUNE_SET /
 * SOUND_MAP_SET rewrite that RAM (which is what the buzzer plays from the next
 * press on), and the same SETTINGS_SAVE as the settings page is what survives a
 * reboot. DISCARD puts the compiled-in shapes back.
 *
 * The firmware is the source of truth for the shapes: the page reads them back
 * after every write, so a preview is the keyboard's tone, not a simulation.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  KEEB_INFO_F_SOUND,
  KEEB_SND_LAYER_OFF,
  KEEB_SND_LAYER_ON,
  KEEB_SND_UPDATE_FAIL,
  KEEB_SND_UPDATE_OK,
  KEEB_SND_WAKE,
  KEEB_SOUND_EVENT_COUNT,
  KEEB_SOUND_STEPS_MAX,
  KEEB_SOUND_TUNE_COUNT,
} from '../proto/constants.ts'
import type { SoundPayload, TuneStep } from '../proto/types.ts'
import { useDeviceStore } from './device.ts'

type WriteResult = { ok: boolean; reason?: string }

/**
 * The tune vocabulary: ids are enum zmk_buzzer_tune order and names are
 * zmk_buzzer_tune_by_name(). The firmware is authoritative; this table is the
 * app's copy of it, and the one place to edit when a tune is added.
 */
export const TUNE_NAMES: string[] = [
  'random',
  'layer_on',
  'layer_off',
  'bootloader',
  'update_ok',
  'update_fail',
  'wake',
]

export interface SoundEventRow {
  /** enum keeb_sound_event / enum zmk_buzzer_event */
  event: number
  label: string
  note: string
}

/** The events the firmware sounds on its own. A chord keeps its own tune in
 * devicetree; these are the ones the keyboard decides to play by itself. */
export const SOUND_EVENTS: SoundEventRow[] = [
  { event: KEEB_SND_LAYER_ON, label: 'layer on', note: 'entering a layer the buzzer announces (beep-layers)' },
  { event: KEEB_SND_LAYER_OFF, label: 'layer off', note: 'leaving that layer' },
  { event: KEEB_SND_UPDATE_OK, label: 'update accepted', note: 'the keymap/panel was saved, discarded or changed' },
  { event: KEEB_SND_UPDATE_FAIL, label: 'update refused', note: 'a write over the link was rejected' },
  { event: KEEB_SND_WAKE, label: 'wake from sleep', note: 'a key press woke the half (beep-on-wake)' },
]

/** What the firmware accepts in one step. Mirrors step_is_sane() in
 * buzzer/src/buzzer.c — the page refuses locally what the board would refuse. */
const PITCH_MIN = 50
const PITCH_MAX = 400
const ON_MIN = 10
const ON_MAX = 1000
const GAP_MAX = 1000

const cloneTune = (steps: TuneStep[]): TuneStep[] => steps.map((s) => ({ ...s }))

const sameSteps = (a: TuneStep[], b: TuneStep[]): boolean =>
  a.length === b.length &&
  a.every((s, i) => s.pitchPct === b[i].pitchPct && s.onMs === b[i].onMs && s.gapMs === b[i].gapMs)

/** A new step at the end; the trailing gap of the previous last step becomes
 * the new step's lead-in, which is what "add a note" means. */
const appendedStep = (steps: TuneStep[]): TuneStep => {
  const last = steps[steps.length - 1]

  return last
    ? { pitchPct: last.pitchPct, onMs: last.onMs, gapMs: 0 }
    : { pitchPct: 100, onMs: 80, gapMs: 0 }
}

export const useSoundStore = defineStore('sound', () => {
  const device = useDeviceStore()

  const loaded = ref(false)
  const loading = ref(false)
  const lastError = ref('')
  const savedAt = ref('')

  /** staged copies: index = event id / tune id */
  const map = ref<number[]>([])
  const tunes = ref<TuneStep[][]>([])
  const remoteMap = ref<number[]>([])
  const remoteTunes = ref<TuneStep[][]>([])

  const supported = computed(() => (((device.info?.flags ?? 0) & KEEB_INFO_F_SOUND) !== 0))
  const canWrite = computed(() => device.writable)

  const eventRows = computed(() =>
    SOUND_EVENTS.map((row) => ({
      row,
      tune: map.value[row.event] ?? 0,
      changed: (map.value[row.event] ?? 0) !== (remoteMap.value[row.event] ?? 0),
    })),
  )

  const tuneCards = computed(() =>
    TUNE_NAMES.slice(0, KEEB_SOUND_TUNE_COUNT).map((name, id) => {
      const steps = tunes.value[id] ?? []
      const remote = remoteTunes.value[id] ?? []
      const changed = !sameSteps(steps, remote)
      /* Tune 0 is generated per press and has no shape; a tune needs at least
       * one step, and the driver's buffer is the hard ceiling. */
      const editable = id !== 0
      const invalid = editable ? steps.findIndex((s) => !stepIsValid(s)) : -1

      return {
        id,
        name,
        steps,
        changed,
        editable,
        invalid: invalid >= 0 ? invalid : null,
        canAdd: editable && steps.length > 0 && steps.length < KEEB_SOUND_STEPS_MAX,
        canRemove: editable && steps.length > 1,
      }
    }),
  )

  function stepIsValid(s: TuneStep): boolean {
    return (
      s.pitchPct >= PITCH_MIN &&
      s.pitchPct <= PITCH_MAX &&
      s.onMs >= ON_MIN &&
      s.onMs <= ON_MAX &&
      s.gapMs >= 0 &&
      s.gapMs <= GAP_MAX
    )
  }

  const problems = computed(() =>
    tuneCards.value
      .filter((c) => c.invalid !== null)
      .map((c) => `${c.name}: step ${(c.invalid ?? 0) + 1} is outside the piezo's ranges`),
  )

  const dirty = computed(
    () =>
      eventRows.value.some((r) => r.changed) ||
      tuneCards.value.some((c) => c.changed),
  )

  const statusLine = computed(() => {
    if (!supported.value) {
      return 'this firmware build does not expose the sound channel'
    }

    if (!loaded.value) {
      return 'sounds not read from the keyboard yet'
    }

    const state = dirty.value
      ? 'edited here, not applied'
      : savedAt.value
        ? `saved to flash at ${savedAt.value}`
        : 'live in the keyboard, not saved to flash'

    return `${SOUND_EVENTS.length} events · ${KEEB_SOUND_TUNE_COUNT} sounds · ${state}`
  })

  function stage(got: SoundPayload): void {
    map.value = Array.from({ length: KEEB_SOUND_EVENT_COUNT }, (_, i) => got.events[i] ?? 0)
    tunes.value = Array.from({ length: KEEB_SOUND_TUNE_COUNT }, (_, i) => cloneTune(got.tunes[i] ?? []))
    remoteMap.value = [...map.value]
    remoteTunes.value = tunes.value.map(cloneTune)
  }

  async function reload(): Promise<void> {
    if (!supported.value || device.state !== 'connected') {
      return
    }

    loading.value = true

    try {
      stage(await device.readSound())
      loaded.value = true
      lastError.value = ''
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function load(): Promise<void> {
    if (!supported.value) {
      loaded.value = false
      lastError.value = 'this firmware build does not expose the sound channel'

      return
    }

    await reload()
  }

  function setEvent(event: number, tune: number): void {
    const next = [...map.value]

    next[event] = tune
    map.value = next
  }

  function setStep(tune: number, index: number, key: keyof TuneStep, raw: string | number): void {
    const steps = tunes.value[tune]

    if (!steps || index < 0 || index >= steps.length) {
      return
    }

    const n = typeof raw === 'number' ? raw : Number(raw)
    const next = tunes.value.map(cloneTune)

    next[tune][index] = { ...next[tune][index], [key]: Number.isFinite(n) ? Math.trunc(n) : 0 }
    tunes.value = next
  }

  function addStep(tune: number): void {
    const steps = tunes.value[tune]

    if (!steps || steps.length === 0 || steps.length >= KEEB_SOUND_STEPS_MAX) {
      return
    }

    const next = tunes.value.map(cloneTune)

    next[tune].push(appendedStep(steps))
    tunes.value = next
  }

  function removeStep(tune: number, index: number): void {
    const steps = tunes.value[tune]

    if (!steps || steps.length <= 1) {
      return
    }

    const next = tunes.value.map(cloneTune)

    next[tune].splice(index, 1)
    tunes.value = next
  }

  /** Throw the working copy away; the keyboard is untouched. */
  function dropLocalEdits(): void {
    if (!loaded.value) {
      return
    }

    map.value = [...remoteMap.value]
    tunes.value = remoteTunes.value.map(cloneTune)
  }

  async function runWrite(fn: () => Promise<unknown>): Promise<WriteResult> {
    try {
      await fn()
      lastError.value = ''

      return { ok: true }
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)

      return { ok: false, reason: lastError.value }
    }
  }

  /**
   * Preview: apply this tune's staged shape first, then ask the keyboard to play
   * it, so what you hear is what the page shows. That is a RAM write, not a
   * save: the shape is live from the next press and still dies with a reboot
   * unless the page is saved.
   */
  async function preview(tune: number): Promise<WriteResult> {
    const card = tuneCards.value.find((c) => c.id === tune)
    const steps = tunes.value[tune] ?? []
    const changed = card?.changed ?? false

    const wrote = await runWrite(async () => {
      if (tune !== 0 && changed && steps.length > 0) {
        await device.writeTune(tune, steps)
        remoteTunes.value = remoteTunes.value.map((t, i) => (i === tune ? cloneTune(steps) : t))
      }

      await device.playTune(tune)
    })

    return wrote
  }

  /** TUNE_SET / SOUND_MAP_SET: the keyboard plays these from the next press. */
  async function apply(): Promise<WriteResult> {
    const bad = problems.value[0]

    if (bad) {
      lastError.value = bad

      return { ok: false, reason: bad }
    }

    if (!dirty.value) {
      lastError.value = 'nothing staged to apply'

      return { ok: false, reason: lastError.value }
    }

    const wrote = await runWrite(async () => {
      for (const card of tuneCards.value) {
        if (card.changed && card.editable && card.steps.length > 0) {
          await device.writeTune(card.id, card.steps)
        }
      }

      for (const row of eventRows.value) {
        if (row.changed) {
          await device.writeSoundMap(row.row.event, row.tune)
        }
      }
    })

    if (wrote.ok) {
      savedAt.value = ''
      await reload()
    }

    return wrote
  }

  /** The same SETTINGS_SAVE as the settings page: one flash write covers both. */
  async function save(): Promise<WriteResult> {
    if (dirty.value) {
      lastError.value = 'apply the staged sounds before saving them'

      return { ok: false, reason: lastError.value }
    }

    const wrote = await runWrite(() => device.settingsSave())

    if (wrote.ok) {
      savedAt.value = new Date().toLocaleTimeString()
    }

    return wrote
  }

  /** SETTINGS_DISCARD: compiled-in shapes back, saved copy deleted. */
  async function discard(): Promise<WriteResult> {
    const wrote = await runWrite(() => device.settingsDiscard())

    if (wrote.ok) {
      savedAt.value = ''
      await reload()
    }

    return wrote
  }

  return {
    loaded, loading, lastError, savedAt, supported, canWrite,
    map, tunes, eventRows, tuneCards, problems, dirty, statusLine,
    load, reload, setEvent, setStep, addStep, removeStep, dropLocalEdits,
    preview, apply, save, discard,
  }
})
