<!--
  The key properties panel in its read-only variant.

  The tester reads the keyboard; it does not change it. So this is the same
  resolved binding the cap is drawn from — keymap.resolve(), the one resolver
  the grid uses — written out in words, with no token picker, no param fields
  and no staged write anywhere in it. An accidental write while a switch is
  half-held mid-test is worse than useless, and the editor is one button away.

  The `edit` button is the only control that changes anything, and it changes
  the view rather than the layout: it hands the selected position to the keymap
  view, where the writing controls live, with the same key still selected.
-->
<script setup lang="ts">
import { computed } from 'vue'

import { describeBinding } from '../model/cap.ts'
import { GRID } from '../proto/zmk.gen.ts'
import { useDeviceStore } from '../stores/device.ts'
import { useKeymapStore } from '../stores/keymap.ts'
import { useTesterStore } from '../stores/tester.ts'

const props = defineProps<{ pos: number | null }>()

const emit = defineEmits<{
  (e: 'edit'): void
  (e: 'press', pos: number): void
}>()

const device = useDeviceStore()
const keymap = useKeymapStore()
const tester = useTesterStore()

const place = computed(() => (props.pos === null ? null : GRID.find((g) => g.pos === props.pos) ?? null))

const resolved = computed(() =>
  props.pos === null ? null : keymap.resolve(keymap.editingSlot, props.pos) ?? null,
)

const binding = computed(() => resolved.value?.binding ?? null)

const display = computed(() => describeBinding(binding.value, keymap.layerName))

/** The newest report this position has made, if it has made one. */
const last = computed(() =>
  props.pos === null ? null : tester.events.find((e) => e.pos === props.pos) ?? null,
)

const closed = computed(() => props.pos !== null && tester.held.has(props.pos))

/* The grid spells the side "L"/"R" because it is generated from the matrix
 * transform. A read-out is prose, so it says the word. */
const half = computed(() => (place.value ? (place.value.side === 'L' ? 'left' : 'right') : ''))

/* A simulated keyboard has no switches to close, so the only way its tester
 * path gets exercised at all is this button. It is absent on real hardware,
 * where the finger does it and the keyboard reports the result. */
const simulated = computed(() => device.kind === 'mock')

const hex = (v: number): string => `0x${(v >>> 0).toString(16).toUpperCase()}`

const params = computed(() => {
  if (!binding.value) {
    return '—'
  }

  const p1 = binding.value.param1 >>> 0
  const p2 = binding.value.param2 >>> 0

  return p2 === 0 ? hex(p1) : `${hex(p1)} · ${hex(p2)}`
})

const lastLine = computed(() => {
  if (props.pos === null) {
    return '—'
  }

  if (!last.value) {
    return 'never reported'
  }

  const at = new Date(last.value.at).toLocaleTimeString([], { hour12: false })
  const state = last.value.pressed ? 'closed' : 'open'
  const layer = keymap.layerName(last.value.layer)

  return `${state} at ${at} on ${layer}`
})
</script>

<template>
  <div class="readout">
    <p v-if="pos === null" class="why">select a key on the board to read its binding</p>

    <template v-else>
      <div class="head">
        <span class="cap-label">{{ display.main || '·' }}</span>

        <span class="where">
          position <b>{{ pos }}</b>
          <template v-if="place"> · row {{ place.row }} col {{ place.col }} · {{ half }} half</template>
          <template v-else> · not in this board’s matrix</template>
        </span>

        <button
          class="act"
          :disabled="!device.writable"
          title="go to the keymap view with this position still selected"
          @click="emit('edit')"
        >
          edit
        </button>
      </div>

      <dl>
        <div>
          <dt>behavior</dt>
          <dd>{{ display.tokenLabel }} <span class="dim">{{ display.tokenName }}</span></dd>
        </div>
        <div>
          <dt>binding</dt>
          <dd>
            {{ display.main || '—' }}
            <template v-if="display.hold"> / hold {{ display.hold }}</template>
            <span v-if="display.hint" class="dim">{{ display.hint }}</span>
          </dd>
        </div>
        <div>
          <dt>params</dt>
          <dd>{{ params }}</dd>
        </div>
        <div>
          <dt>read from</dt>
          <dd>{{ keymap.editingName }} · slot {{ keymap.editingSlot }}</dd>
        </div>
        <div>
          <dt>switch</dt>
          <dd :class="{ bad: last === null, hot: closed }">
            {{ closed ? 'closed now' : lastLine }}
          </dd>
        </div>
      </dl>

      <button
        v-if="simulated"
        class="act press"
        title="simulated keyboard: close this switch for a moment"
        @click="emit('press', pos)"
      >
        press
      </button>
    </template>
  </div>
</template>

<style scoped>
/* The readout is a list of facts, not a form: nothing here is an input, so
 * nothing here looks like one. A readonly <input> invites a click that cannot
 * do anything. */
.readout {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.cap-label {
  min-width: 42px;
  padding: 4px 8px;
  border: 1px solid var(--ink);
  background: var(--ink);
  color: var(--on-ink);
  font-weight: 700;
  text-align: center;
}

.where { font-size: 12px; color: var(--mid); }
.where b { color: var(--ink); }

dl {
  margin: 0;
  display: flex;
  flex-direction: column;
}

dl > div {
  display: flex;
  gap: 10px;
  border-bottom: 1px solid var(--line);
  padding: 4px 0;
}

dt {
  width: 84px;
  flex: none;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--mid);
}

dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.dim { color: var(--mid); font-size: 12px; }

dd.bad { color: var(--err); }
dd.hot { color: var(--ink); font-weight: 700; }

.why { margin: 0; font-size: 12px; color: var(--mid); }

/* The one control that reaches the keyboard's state, so it is drawn as the
 * other buttons here are drawn: a hairline, and a leading colon. */
.act {
  align-self: flex-start;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--mid);
  font: inherit;
  font-size: 12px;
  padding: 3px 10px;
  cursor: pointer;
}

.act::before { content: ':'; color: var(--mid); font-weight: 700; margin-right: 4px; }
.act:hover:not(:disabled) { color: var(--ink); border-color: var(--ink); }
.act:disabled { opacity: 0.62; cursor: default; }

/* Only exists on the simulated keyboard. */
.act.press { margin-top: 2px; }
</style>
