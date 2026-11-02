<!--
  The sidebar's binding properties.

  The grid selects a key, the palette under the keyboard chooses what it becomes,
  and this panel is the narrow column of things that are *properties* of the
  binding rather than the binding itself: inherit or disable, unstage what has
  not been sent, and move to another layer.

  The bindings with arguments this column cannot hold as chips are not here -
  they are the `advanced binding` group further down the same column.

  Nothing here is a text field. A keyboard that is broken is repaired by clicking
  — and a control you can only use by typing is no use at all to the thing that
  cannot type.

  Staging is still the rule: nothing here reaches the keyboard until Apply.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'

import { TOKENS } from '../proto/zmk.gen.ts'
import type { Binding } from '../proto/types.ts'
import { useDeviceStore } from '../stores/device.ts'
import { LAYER_ID_INVALID, NONE_TOKEN, TRANSPARENT_TOKEN, useKeymapStore } from '../stores/keymap.ts'
import Disclosure from './Disclosure.vue'

const props = defineProps<{ pos: number | null; reserved: boolean }>()

const emit = defineEmits<{
  (e: 'set', binding: Binding): void
  (e: 'revert'): void
}>()

const device = useDeviceStore()
const keymap = useKeymapStore()

/* `&mo` is what a layer key almost always is, so its chips are on the surface.
 * The other three are one group header deeper. */
const otherOp = ref<'to' | 'tog' | 'sl'>('to')

const OP_NOTE: Record<'mo' | 'to' | 'tog' | 'sl', string> = {
  mo: 'momentary while held',
  to: 'switch to, and stay',
  tog: 'toggle on or off',
  sl: 'switch to, then latch',
}

const readyIds = computed(() => new Set(device.readyTokens.map((t) => t.token)))
const hasDeviceTokens = computed(() => device.tokens.length > 0)

const usable = (token: number): boolean => !hasDeviceTokens.value || readyIds.value.has(token)

const canWrite = computed(
  () => props.pos !== null && !props.reserved && keymap.editingId !== LAYER_ID_INVALID,
)

function layerHitsFor(op: 'mo' | 'to' | 'tog' | 'sl') {
  const token = TOKENS.find((t) => t.label === op)

  if (!token || !usable(token.id)) {
    return []
  }

  return keymap.slots
    .filter((s) => s.id !== LAYER_ID_INVALID)
    .map((s) => ({
      slot: s.index,
      id: s.id,
      name: s.name,
      live: s.live,
      dirty: s.dirty,
      binding: { token: token.id, param1: s.id, param2: 0 } as Binding,
      label: `&${op} ${s.id}`,
      note: `slot ${s.index} · ${s.name}${s.live ? ' · live' : ''}${s.dirty ? ` · ${s.dirty} staged` : ''}`,
    }))
}

const moHits = computed(() => layerHitsFor('mo'))
const otherHits = computed(() => layerHitsFor(otherOp.value))

const staged = computed(() => props.pos !== null && keymap.isPending(keymap.editingSlot, props.pos))

function stage(binding: Binding): void {
  if (!canWrite.value) {
    return
  }

  emit('set', binding)
}
</script>

<template>
  <section class="bind">
    <h3>
      bind
      <span class="where">
        <template v-if="pos === null">no key selected</template>
        <template v-else>position {{ pos }} · {{ keymap.editingName }}</template>
      </span>
    </h3>

    <p v-if="reserved" class="hint bad">
      position {{ pos }} is reserved — the firmware will not rebind it
    </p>

    <div class="cell">
      <button class="chip" :disabled="!canWrite" title="&trans — this layer inherits the key from the layer below" @click="stage({ token: TRANSPARENT_TOKEN, param1: 0, param2: 0 })">
        &amp;trans
      </button>
      <button class="chip" :disabled="!canWrite" title="&none — this key does nothing on this layer" @click="stage({ token: NONE_TOKEN, param1: 0, param2: 0 })">
        &amp;none
      </button>
      <button
        class="chip"
        :disabled="!staged"
        title="throw this cell's staged binding away; the keyboard was never asked to change"
        @click="emit('revert')"
      >
        unstage
      </button>
    </div>

    <h3>
      layers
      <span class="where">&amp;mo — momentary while held</span>
    </h3>

    <div class="chips">
      <button
        v-for="l in moHits"
        :key="l.slot"
        class="chip layer"
        :class="{ live: l.live }"
        :disabled="!canWrite"
        :title="`stage ${l.label} — ${l.note} at position ${pos}`"
        @click="stage(l.binding)"
      >
        {{ l.name }}
      </button>

      <div v-if="!moHits.length" class="hint">no layer slots on the keyboard</div>
    </div>

    <Disclosure label="other layer ops" hint="switch · toggle · latch">
      <div class="seg" role="group" aria-label="layer behavior">
        <button
          v-for="op in (['to', 'tog', 'sl'] as const)"
          :key="op"
          class="chip"
          :class="{ on: otherOp === op }"
          :title="`&${op} — ${OP_NOTE[op]}`"
          @click="otherOp = op"
        >
          &amp;{{ op }}
        </button>
      </div>

      <div class="chips">
        <button
          v-for="l in otherHits"
          :key="l.slot"
          class="chip layer"
          :disabled="!canWrite"
          :title="`stage ${l.label} — ${l.note} at position ${pos}`"
          @click="stage(l.binding)"
        >
          {{ l.name }}
        </button>
      </div>
    </Disclosure>
  </section>
</template>

<style scoped>
.bind {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 6px 0 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--mid);
}

.where {
  margin-left: auto;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--mid);
}

.hint { margin: 0; font-size: 12px; color: var(--mid); }
.hint.bad { color: var(--err); }

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--mid);
  font-family: var(--mono);
  font-size: 12px;
  padding: 4px 8px;
  cursor: pointer;
}

.chip:hover:not(:disabled) { color: var(--ink); border-color: var(--ink); }
.chip.on { background: var(--mod); color: var(--ink); border-color: var(--ink); font-weight: 700; }
.chip:disabled { opacity: 0.62; cursor: not-allowed; }

.chip.layer {
  font-weight: 700;
  color: var(--ink);
  min-width: 46px;
}

.chip.layer.live { background: var(--soft); }

.cell {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
</style>
