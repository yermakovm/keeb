/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * TLV channel trace.
 *
 * Debugging this channel is always the same question: what did we send, and what
 * did the keyboard say back. The protocol answers it with one ACK per message
 * (`keeb_engine.c` holds a reply slot for exactly that reason), so the trace is
 * one line per message in each direction, plus the notifications the keyboard
 * sends on its own.
 *
 * What a line looks like:
 *
 *   keeb tlv  tx #7  CELLS_SET(0x1003) 812B
 *   keeb tlv  rx #7  ACK(0x1000) CELLS(0x1002) 96B
 *   keeb tlv  ack#7  OK detail=12
 *   keeb tlv  evt    CELLS_SET seq 3 3B
 *   keeb tlv  err#7  no ACK for message 7 in 4000ms
 *
 * On by default, because a configurator with no transport trace is a
 * configurator you debug by guessing. Silence it with
 * `localStorage.setItem('keeb.debug', '0')` (or `?debug=0` for one load);
 * `keeb.debug = '1'` turns it back on.
 *
 * The buffer is kept in module state rather than in a store so the transport and
 * the protocol layer can both write to it without either importing the other, and
 * so a test can read what a session actually put on the wire.
 */

import * as C from '../proto/constants.ts'

export type TraceDir = 'tx' | 'rx' | 'ack' | 'evt' | 'err'

export interface TraceEntry {
  at: number
  dir: TraceDir
  /** message id, -1 for a notification (the keyboard originates those ids) */
  msgId: number
  /** short line for the console and for a UI */
  line: string
  /* Structured fields, so a test can assert on a record type rather than on a
   * sentence.
   */
  types: number[]
  bytes: number
  status?: number
  err?: number
  detail?: number
  event?: number
  seq?: number
}

const MAX_ENTRIES = 200
const DEBUG_KEY = 'keeb.debug'

/** Record and event names derived from the mirrored constants, so the trace
 * cannot drift from the protocol it is naming: a new KEEB_T_* is automatically
 * known here.
 */
const NAMES = new Map<number, string>()

for (const [key, value] of Object.entries(C)) {
  if (typeof value === 'number' && (key.startsWith('KEEB_T_') || key.startsWith('KEEB_EV_'))) {
    NAMES.set(value, key.replace(/^KEEB_(T|EV)_/, ''))
  }
}

export const typeName = (type: number): string => NAMES.get(type) ?? `0x${type.toString(16).padStart(4, '0')}`

export const typeHex = (type: number): string => `0x${type.toString(16).padStart(4, '0')}`

const readDebugDefault = (): boolean => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(DEBUG_KEY)

      if (stored !== null) {
        return stored === '1'
      }
    }

    if (typeof window !== 'undefined' && window.location) {
      const q = new URLSearchParams(window.location.search).get('debug')

      if (q !== null) {
        return q !== '0'
      }
    }
  } catch {
    /* No storage, no query: the default stands. */
  }

  /* On in a browser, off outside one. This is a transport trace for a person
   * driving the configurator; the node tests and the SSR render are not that
   * person, and a channel trace printed 60 times a run is noise that hides the
   * test output it was meant to complement.
   */
  return typeof window !== 'undefined'
}

let enabled = readDebugDefault()
const entries: TraceEntry[] = []
const listeners = new Set<(e: TraceEntry) => void>()

export function traceEnabled(): boolean {
  return enabled
}

/** Turn tracing on or off, remembered per browser. */
export function setTraceEnabled(on: boolean): void {
  enabled = on

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(DEBUG_KEY, on ? '1' : '0')
    }
  } catch {
    /* A browser that will not store the preference still traces for this load. */
  }
}

export function traceEntries(): readonly TraceEntry[] {
  return entries
}

export function clearTrace(): void {
  entries.length = 0
}

/** Subscribe to trace lines (for a store or a debug panel). Returns the unsubscribe. */
export function onTrace(cb: (e: TraceEntry) => void): () => void {
  listeners.add(cb)

  return () => listeners.delete(cb)
}

/**
 * Record one channel event. Returns null when tracing is off, so callers can
 * skip building the human-readable part.
 */
export function trace(
  dir: TraceDir,
  msgId: number,
  opts: {
    types?: number[]
    bytes?: number
    status?: number
    err?: number
    detail?: number
    event?: number
    seq?: number
    note?: string
  } = {},
): TraceEntry | null {
  if (!enabled) {
    return null
  }

  const types = opts.types ?? []
  const head = opts.event !== undefined ? 'evt' : `${dir}${msgId >= 0 ? ` #${msgId}` : ''}`
  const parts = [`keeb tlv  ${head.padEnd(6)}`]

  if (opts.event !== undefined) {
    parts.push(typeName(opts.event))

    if (opts.seq !== undefined) {
      parts.push(`seq ${opts.seq}`)
    }
  } else if (types.length) {
    parts.push(types.map((t) => `${typeName(t)}(${typeHex(t)})`).join(' '))
  }

  if (opts.bytes !== undefined) {
    parts.push(`${opts.bytes}B`)
  }

  if (opts.status !== undefined) {
    parts.push(opts.status === 0 ? `OK${opts.detail ? ` detail=${opts.detail}` : ''}` : `ERR 0x${(opts.err ?? 0).toString(16)}`)
  }

  if (opts.err !== undefined && opts.status === undefined) {
    parts.push(`err 0x${opts.err.toString(16)}`)
  }

  if (opts.note) {
    parts.push(opts.note)
  }

  const line = parts.join('  ')
  const entry: TraceEntry = {
    at: Date.now(),
    dir,
    msgId,
    line,
    types,
    bytes: opts.bytes ?? 0,
    status: opts.status,
    err: opts.err,
    detail: opts.detail,
    event: opts.event,
    seq: opts.seq,
  }

  entries.push(entry)

  if (entries.length > MAX_ENTRIES) {
    entries.shift()
  }

  if (dir === 'err') {
    console.warn(line)
  } else {
    console.log(line)
  }

  for (const l of listeners) {
    l(entry)
  }

  return entry
}
