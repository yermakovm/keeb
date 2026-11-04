<script setup lang="ts">
/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * The log panel: the console, in the corner of the page.
 *
 * Bottom-right, out of the way, opened from the footer. It shows the transport
 * trace and everything the configurator says out loud, newest at the bottom the
 * way a terminal prints them.
 *
 * The filter is a filter on *kind*, not a search: the question is nearly always
 * "did what we sent get acknowledged", and the answer is one of tx / rx / ack /
 * evt / err. `err` is the only one that changes what you do next.
 */
import { computed, nextTick, ref, watch } from 'vue'

import { setTraceEnabled, traceEnabled } from '../debug/trace.ts'
import { useLogStore, type LogKind } from '../stores/log.ts'

defineProps<{ open: boolean }>()

const emit = defineEmits<{ (e: 'close'): void }>()

const log = useLogStore()

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
  if (!follow.value) {
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
</script>

<template>
  <section v-if="open" class="term" aria-label="Log">
    <header>
      <span class="prompt">~/cosmotyl/log</span>
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
      <button class="cmd" :class="{ on: follow }" :aria-pressed="follow" title="keep the view pinned to the newest line" @click="follow = !follow">follow</button>
      <button class="cmd" :class="{ on: tracing }" :aria-pressed="tracing" title="trace.ts writes each TLV message to the console and to this panel" @click="toggleTrace">trace</button>
      <button class="cmd" title="empty the panel and the transport buffer" @click="log.clear()">clear</button>
      <button class="cmd close" title="close (Esc)" @click="emit('close')">✕</button>
    </header>

    <div ref="body" class="body" @scroll="follow = (body?.scrollTop ?? 0) + body!.clientHeight >= body!.scrollHeight - 4">
      <p v-if="!shown.length" class="empty">no lines yet — the panel fills as soon as a message goes on the wire</p>
      <p v-for="(l, i) in shown" :key="i" class="line">
        <span class="t">{{ log.at(l.at) }}</span>
        <span class="k" :class="cls(l.kind)">{{ l.kind }}</span>
        <span class="m">{{ clean(l.kind, l.line) }}</span>
      </p>
    </div>
  </section>
</template>

<style scoped>
/* Bottom-right, above everything else on the page, sized like a terminal pane. */
.term {
  position: fixed;
  right: 14px;
  bottom: 44px;
  width: min(760px, calc(100vw - 28px));
  max-height: min(46vh, 420px);
  display: flex;
  flex-direction: column;
  background: var(--bg-inset);
  border: 1px solid var(--line);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  z-index: 40;
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
  box-shadow: inset 0 -3px 0 var(--ink);
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

.cmd:hover { border-color: var(--ink); color: var(--ink); }
.cmd.on {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--on-ink);
}
.cmd.close { border: 0; }

.body {
  flex: 1;
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

@media (max-width: 600px) {
  .term { right: 6px; left: 6px; bottom: 40px; max-height: 40vh; }
  .line { grid-template-columns: 6ch 1fr; }
  .k { display: none; }
}
</style>
