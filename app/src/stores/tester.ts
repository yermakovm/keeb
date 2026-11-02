import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { KEEB_EV_KEY } from '../proto/protocol.gen.ts'
import { KEY_COUNT } from '../proto/zmk.gen.ts'
import { useDeviceStore, type DeviceEvent } from './device.ts'

/** One switch the keyboard reported: the position a CELLS record would use,
 * whether it closed or opened, and the layer the keyboard was on at that instant. */
export interface ReportedKey {
  seq: number
  at: number
  pos: number
  pressed: boolean
  layer: number
}

/* The tester is a screen you stare at while pressing things, so it keeps a
 * bounded history rather than everything since connect: a keyboard typed at for
 * ten minutes is thousands of events, and the useful part is the last page of them. */
const MAX_EVENTS = 200

export const useTesterStore = defineStore('tester', () => {
  const device = useDeviceStore()

  const events = ref<ReportedKey[]>([])
  const held = ref<Set<number>>(new Set())
  const seen = ref<Set<number>>(new Set())
  const pressCount = ref(0)
  const releaseCount = ref(0)
  const lastError = ref('')

  /* Positions the keyboard never reported. A dead switch, a dead column, or a
   * diode wired to the wrong row all look like this: everything else lights up
   * and this one does not. */
  const neverPressed = computed(() => {
    const out: number[] = []

    for (let pos = 0; pos < KEY_COUNT; pos++) {
      if (!seen.value.has(pos)) {
        out.push(pos)
      }
    }

    return out
  })

  const coverage = computed(() => `${seen.value.size}/${KEY_COUNT} positions reported`)

  let unsub: (() => void) | null = null

  function ingest(e: DeviceEvent): void {
    if (e.event !== KEEB_EV_KEY) {
      return
    }

    const d = e.data

    if (d.length < 3) {
      lastError.value = `key event is ${d.length} byte(s), expected 3`
      return
    }

    const pos = d[0]
    const pressed = d[1] !== 0
    const layer = d[2]

    const next = new Set(held.value)

    if (pressed) {
      next.add(pos)
      pressCount.value += 1
    } else {
      next.delete(pos)
      releaseCount.value += 1
    }

    held.value = next
    seen.value = new Set(seen.value).add(pos)

    events.value = [{ seq: e.seq, at: Date.now(), pos, pressed, layer }, ...events.value].slice(0, MAX_EVENTS)
  }

  /** Open the tester: ask the keyboard to report its switches. */
  async function open(): Promise<boolean> {
    if (!unsub) {
      unsub = device.onEvent(ingest)
    }

    lastError.value = ''

    try {
      return await device.setTestMode(true)
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  /** Close it: stop asking, so a keyboard that is being typed on is not streaming. */
  async function close(): Promise<void> {
    unsub?.()
    unsub = null
    held.value = new Set()

    try {
      await device.setTestMode(false)
    } catch {
      /* A keyboard that is already gone cannot be told to stop. */
    }
  }

  function clear(): void {
    events.value = []
    seen.value = new Set()
    pressCount.value = 0
    releaseCount.value = 0
    lastError.value = ''
  }

  return { events, held, seen, pressCount, releaseCount, lastError, neverPressed, coverage, open, close, clear, MAX_EVENTS }
})
