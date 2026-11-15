<script setup lang="ts">
/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * The log panel: the console, as its own page.
 *
 * It is a first-class view like settings: it owns the whole main area and the
 * logs sit in a centred, fully-opaque card instead of a floating overlay.
 *
 * Two tabs. "log" is the transport trace and everything the configurator says
 * out loud, newest at the bottom the way a terminal prints them, filterable by
 * kind (tx / rx / ack / evt / err / ui). "keys" is the tester's key-event
 * reporting: what the keyboard reported, in order, with the facts a wiring
 * problem is diagnosed from.
 */
import { computed, nextTick, ref, watch } from 'vue'

import { setTraceEnabled, traceEnabled } from '../debug/trace.ts'
import { describeBinding } from '../model/cap.ts'
import { GRID } from '../proto/zmk.gen.ts'
import { useDeviceStore } from '../stores/device.ts'
import { useKeymapStore } from '../stores/keymap.ts'
import { useLogStore, type LogKind } from '../stores/log.ts'
import { useTesterStore } from '../stores/tester.ts'

const log = useLogStore()
const tester = useTesterStore()
const device = useDeviceStore()
const keymap = useKeymapStore()

/* ---------------------------------------------------------------- log tab */

const FILTERS: Array<{ key: LogKind | 'all'; label: string }> = [
  { key: 'all', label: 'all' },
  { key: 'tx', label: 'tx' },
  { key: 'rx', label: 'rx' },
  { key: 'ack', label: 'ack' },
  { key: 'evt', label: 'evt' },
  { key: 'err', label: 'err' },
  { key: 'ui', label: 'ui' },
]

const filter = ref<LogKind | 'all'>('all')
/** Trace on the wire is what fills this panel; trace.ts owns the switch. */
const tracing = ref(traceEnabled())

const body = ref<HTMLElement | null>(null)

const shown = computed(() =>
  filter.value === 'all' ? log.lines : log.lines.filter((l) => l.kind === filter.value),
)

const follow = ref(true)

watch(shown, async () => {
  if (tab.value !== 'log' || !follow.value) {
    return
  }

  await nextTick()

  if (body.value) {
    body.value.scrollTop = body.value.scrollHeight
  }
}, { flush: 'post' })

function toggleTrace(): void {
  tracing.value = !tracing.value
  setTraceEnabled(tracing.value)
  log.note(`transport trace ${tracing.value ? 'on' : 'off'}`)
}

const cls = (k: LogKind): string => (k === 'err' ? 'err' : k === 'tx' ? 'tx' : k === 'rx' ? 'rx' : k === 'evt' ? 'evt' : k === 'ui' ? 'ui' : 'ack')

/** Strip the trace header from the message — the kind and msg id are already
 * shown in their own column. */
function clean(kind: LogKind, line: string): string {
  if (kind === 'ui') return line
  // "keeb tlv  tx #1   INFO(...)" → "INFO(...)"
  return line.replace(/^keeb tlv\s+\S+(?:\s+#\d+)?\s+/, '')
}

/* ---------------------------------------------------------------- keys tab */

const tab = ref<'log' | 'keys'>('log')

const byPos = new Map(GRID.map((g) => [g.pos, g]))

const rows = computed(() =>
  tester.events.map((e) => {
    const g = byPos.get(e.pos) ?? null
    const slot = keymap.slots.find((s) => s.id === e.layer) ?? null
    const binding = slot ? keymap.resolve(slot.index, e.pos)?.binding ?? null : null

    return {
      seq: e.seq,
      pos: e.pos,
      row: g?.row ?? -1,
      col: g?.col ?? -1,
      side: g?.side ?? '?',
      layerName: slot ? keymap.layerName(e.layer) : 'unknown layer',
      pressed: e.pressed,
      binding: describeBinding(binding, keymap.layerName).main,
      at: new Date(e.at).toLocaleTimeString([], { hour12: false }),
    }
  }),
)

const keysSummary = computed(
  () =>
    `${tester.pressCount} press · ${tester.releaseCount} release · ${tester.coverage} · ${tester.events.length} shown`,
)
</script>

<template>
  <section class="logs-page" aria-label="Log">
    <div class="logs-card">
    <header>
      <div class="seg tab-seg">
        <button :aria-pressed="tab === 'log'" @click="tab = 'log'">Log</button>
        <button :aria-pressed="tab === 'keys'" @click="tab = 'keys'">Keys</button>
      </div>

      <template v-if="tab === 'log'">
        <div class="seg">
          <button
            v-for="f in FILTERS"
            :key="f.key"
            :aria-pressed="filter === f.key"
            @click="filter = f.key"
          >
            {{ f.label }}
          </button>
        </div>

        <span class="count">{{ shown.length }}/{{ log.lines.length }}<template v-if="log.errors"> · {{ log.errors }} err</template></span>
        <div class="spacer" />
        <button class="cmd" :class="{ on: follow }" :aria-pressed="follow" title="keep the view pinned to the newest line" @click="follow = !follow">Follow</button>
        <button class="cmd" :class="{ on: tracing }" :aria-pressed="tracing" title="trace.ts writes each TLV message to the console and to this panel" @click="toggleTrace">Trace</button>
        <button class="cmd" title="empty the panel and the transport buffer" @click="log.clear()">Clear</button>
      </template>

      <template v-else>
        <span class="live" :class="{ on: device.testMode }">
          {{ device.testMode ? 'reporting' : 'idle' }}
        </span>
        <span class="count">{{ keysSummary }}</span>
        <div class="spacer" />
        <button class="cmd" :disabled="!tester.events.length" title="clear the log; the counts start over" @click="tester.clear()">Clear</button>
      </template>
    </header>

    <div v-if="tab === 'log'" ref="body" class="body" @scroll="follow = (body?.scrollTop ?? 0) + body!.clientHeight >= body!.scrollHeight - 4">
      <p v-if="!shown.length" class="empty">no lines yet — the panel fills as soon as a message goes on the wire</p>
      <p v-for="(l, i) in shown" :key="i" class="line">
        <span class="t">{{ log.at(l.at) }}</span>
        <span class="k" :class="cls(l.kind)">{{ l.kind }}</span>
        <span class="m">{{ clean(l.kind, l.line) }}</span>
      </p>
    </div>

    <div v-else class="body">
      <p v-if="tester.lastError" class="note bad">{{ tester.lastError }}</p>
      <p v-if="!rows.length" class="empty">nothing reported yet — press a key on the keyboard</p>

      <table>
        <thead>
          <tr>
            <th>time</th>
            <th>pos</th>
            <th>rc</th>
            <th>side</th>
            <th>layer</th>
            <th>state</th>
            <th>binding</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="`${r.seq}-${i}`" :class="{ press: r.pressed }">
            <td>{{ r.at }}</td>
            <td>{{ r.pos }}</td>
            <td>{{ r.row }}·{{ r.col }}</td>
            <td>{{ r.side }}</td>
            <td>{{ r.layerName }}</td>
            <td>{{ r.pressed ? 'closed' : 'open' }}</td>
            <td>{{ r.binding }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    </div>
  </section>
</template>

<style scoped>
/* The page owns the whole main area and centres the opaque card. It is pushed
 * down only far enough to clear the floating top nav pill; on small screens
 * main's own padding-top already does that, so the offset drops to zero. */
.logs-page {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  justify-content: center;
  padding-top: 116px;
  padding-bottom: 12px;
}

/* A fully-opaque card holding the console: solid ground, no translucency. */
.logs-card {
  width: min(880px, 100%);
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  font-size: 12px;
  flex-wrap: wrap;
}

.prompt {
  color: var(--ink);
  font-weight: 700;
}

.spacer { flex: 1; }

.count { color: var(--mid); }

.seg { display: inline-flex; border: 1px solid var(--line); }

.seg button {
  padding: 1px 8px;
  background: transparent;
  border: 0;
  border-right: 1px solid var(--line);
  color: var(--mid);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.seg button:last-child { border-right: 0; }

.seg button[aria-pressed='true'] {
  background: var(--mod);
  color: var(--ink);
  box-shadow: inset 0 -3px 0 var(--accent);
}

.tab-seg button { font-weight: 700; }

.live {
  font-size: 12px;
  color: var(--mid);
  border: 1px solid var(--line);
  padding: 1px 6px;
}

.live.on {
  background: var(--mod);
  color: var(--ink);
  border-color: var(--ink);
  font-weight: 700;
}

.cmd {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--mid);
  font: inherit;
  font-size: 12px;
  padding: 1px 8px;
  cursor: pointer;
}

.cmd:hover:not(:disabled) { border-color: var(--ink); color: var(--ink); }
.cmd:disabled { opacity: 0.5; cursor: default; }
.cmd.on {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--on-ink);
}

.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 6px 8px 8px;
  font-size: 12px;
  line-height: 1.45;
}

.line { margin: 0; display: grid; grid-template-columns: 8ch 4ch 1fr; gap: 12px; }

.t { color: var(--mid); }
.k { font-weight: 700; }
.k.tx { color: var(--ink); }
.k.rx { color: var(--ink); }
.k.ack { color: var(--ok); }
.k.evt { color: var(--mid); }
.k.err { color: var(--err); }
.k.ui { color: var(--mid); }

.m { white-space: pre-wrap; word-break: break-word; }

.err .m { color: var(--err); }

.empty { color: var(--mid); margin: 0; }

.note { margin: 0 0 6px; font-size: 12px; color: var(--mid); }
.note.bad { color: var(--err); }

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

th,
td {
  text-align: left;
  border-bottom: 1px solid var(--line);
  padding: 3px 6px;
  white-space: nowrap;
}

th {
  color: var(--mid);
  font-weight: 400;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 10px;
}

tbody tr.press td:first-child { box-shadow: inset 3px 0 0 var(--ink); }

@media (max-width: 600px) {
  .logs-page { padding-top: 0; padding-bottom: 10px; }
  .line { grid-template-columns: 6ch 1fr; }
  .k { display: none; }
}
</style>