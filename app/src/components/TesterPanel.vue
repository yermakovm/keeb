<!--
  The tester's other half: the log.

  The board shows which switches are closed right now, and which ones have never
  closed at all. This shows what the keyboard reported, in order, with the facts
  a wiring problem is diagnosed from: the position, the row and column it sits on,
  the layer the keyboard was on, and whether the switch closed or opened.

  The dead-switch list is not spelled out here any more: a position that has never
  reported is drawn as a dashed, recessed cap on the board, which is where the
  wiring fault actually is. The count stays in the header.

  It is a ring, not a transcript — the last MAX_EVENTS reports — because a
  tester is open while someone presses things for a while, and the useful part
  of that is the end of it.
-->
<script setup lang="ts">
import { computed } from 'vue'

import { describeBinding } from '../model/cap.ts'
import { GRID } from '../proto/zmk.gen.ts'
import { useDeviceStore } from '../stores/device.ts'
import { useKeymapStore } from '../stores/keymap.ts'
import { useTesterStore } from '../stores/tester.ts'

const device = useDeviceStore()
const keymap = useKeymapStore()
const tester = useTesterStore()

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
      layer: e.layer,
      layerName: slot ? keymap.layerName(e.layer) : 'unknown layer',
      pressed: e.pressed,
      binding: describeBinding(binding, keymap.layerName).main,
      at: new Date(e.at).toLocaleTimeString([], { hour12: false }),
    }
  }),
)

const summary = computed(
  () =>
    `${tester.pressCount} press · ${tester.releaseCount} release · ${tester.coverage} · ${tester.events.length} shown`,
)
</script>

<template>
  <section class="tester">
    <header>
      <h2>key events</h2>

      <span class="live" :class="{ on: device.testMode }">
        {{ device.testMode ? 'reporting' : 'not reporting' }}
      </span>

      <span class="meta">{{ summary }}</span>

      <button class="chip" :disabled="!tester.events.length" title="clear the log; the counts start over" @click="tester.clear()">
        clear
      </button>
    </header>

    <p v-if="device.kind === 'mock'" class="note">
      simulated keyboard: select a key, then press it from the read-out — the event travels the same notification path real hardware uses
    </p>

    <p v-if="tester.lastError" class="note bad">{{ tester.lastError }}</p>

    <table>
      <thead>
        <tr>
          <th>time</th>
          <th>pos</th>
          <th>row</th>
          <th>col</th>
          <th>side</th>
          <th>layer</th>
          <th>state</th>
          <th>binding there</th>
          <th>seq</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="`${r.seq}-${r.pos}-${r.pressed}`" :class="{ press: r.pressed }">
          <td>{{ r.at }}</td>
          <td>{{ r.pos }}</td>
          <td>{{ r.row }}</td>
          <td>{{ r.col }}</td>
          <td>{{ r.side }}</td>
          <td>{{ r.layer }} · {{ r.layerName }}</td>
          <td>{{ r.pressed ? 'closed' : 'open' }}</td>
          <td>{{ r.binding }}</td>
          <td>{{ r.seq }}</td>
        </tr>

        <tr v-if="!rows.length">
          <td colspan="9" class="empty">nothing reported yet — press a key on the keyboard</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.tester {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--line);
  background: var(--panel);
  padding: 14px;
  min-width: 0;
}

header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink);
}

.live {
  font-size: 12px;
  color: var(--mid);
  border: 1px solid var(--line);
  padding: 2px 6px;
}

.live.on {
  background: var(--mod);
  color: var(--ink);
  border-color: var(--ink);
  font-weight: 700;
}

.meta { font-size: 12px; color: var(--mid); margin-left: auto; }

.note { margin: 0; font-size: 12px; color: var(--mid); }
.note.bad { color: var(--err); }

.chip {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--mid);
  font: inherit;
  font-size: 12px;
  padding: 3px 8px;
  cursor: pointer;
}

.chip:hover:not(:disabled) { color: var(--ink); border-color: var(--ink); }
.chip:disabled { opacity: 0.62; cursor: not-allowed; }

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

th,
td {
  text-align: left;
  border-bottom: 1px solid var(--line);
  padding: 4px 6px;
  white-space: nowrap;
}

th {
  color: var(--mid);
  font-weight: 400;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 11px;
}

tbody tr.press { background: var(--bg-inset); }
tbody tr.press td:first-child { box-shadow: inset 3px 0 0 var(--ink); }

.empty { color: var(--mid); }
</style>
