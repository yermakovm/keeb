/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * The console, kept in a store so the UI can show it.
 *
 * Everything worth seeing while this app works already goes to the browser
 * console: `src/debug/trace.ts` prints one line per TLV message in each
 * direction, and the app prints one line per user-visible outcome. The problem
 * with the console is that it is outside the page you are looking at — you have
 * to open DevTools, and the line you needed has scrolled away.
 *
 * So this store subscribes to the same two sources and holds them in one ring:
 *
 *   - `onTrace()` from debug/trace.ts — the transport, verbatim;
 *   - `note()` — anything the configurator says out loud.
 *
 * Nothing here replaces the console. trace.ts still writes to it, and this store
 * is a second reader of the same buffer, not a replacement for it: a store the
 * transport had to be pointed at would be a store the transport could refuse to
 * write to.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { clearTrace, onTrace, traceEntries, type TraceDir, type TraceEntry } from '../debug/trace.ts'

/** `ui` is a line the configurator said; every other kind comes from the wire. */
export type LogKind = TraceDir | 'ui'

export interface LogLine {
  at: number
  kind: LogKind
  line: string
  /** TLV message id, -1 for a notification or a UI line */
  msgId: number
}

const MAX_LINES = 400

export const useLogStore = defineStore('log', () => {
  const lines = ref<LogLine[]>([])
  let off: (() => void) | null = null

  const push = (line: LogLine): void => {
    lines.value.push(line)

    if (lines.value.length > MAX_LINES) {
      lines.value.shift()
    }
  }

  /** Start mirroring the transport. Safe to call more than once. */
  function attach(): void {
    if (off) {
      return
    }

    // Whatever trace.ts already printed is part of the picture: a panel that
    // only shows what happens after it opens would hide the failure that
    // caused it to be opened.
    for (const e of traceEntries()) {
      push({ at: e.at, kind: e.dir, line: e.line, msgId: e.msgId })
    }

    off = onTrace((e: TraceEntry) => {
      push({ at: e.at, kind: e.dir, line: e.line, msgId: e.msgId })
    })
  }

  function detach(): void {
    off?.()
    off = null
  }

  /** A line the configurator said out loud. */
  function note(msg: string, kind: LogKind = 'ui'): void {
    push({ at: Date.now(), kind, line: msg, msgId: -1 })
  }

  function clear(): void {
    lines.value = []
    clearTrace()
  }

  const errors = computed(() => lines.value.filter((l) => l.kind === 'err').length)

  const at = (t: number): string =>
    new Date(t).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return { lines, attach, detach, note, clear, errors, at }
})
