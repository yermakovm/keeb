<!--
  The sidebar's binding properties.

  Quick actions: inherit (&trans), disable (&none), and revert a staged edit.
  Nothing here is a text field — a broken keyboard is fixed by clicking.

  The actual binding picker lives in the KeyPalette under the board.
-->
<script setup lang="ts">
import { computed } from 'vue'

import type { Binding } from '../proto/types.ts'
import { LAYER_ID_INVALID, NONE_TOKEN, TRANSPARENT_TOKEN, useKeymapStore } from '../stores/keymap.ts'

const props = defineProps<{ pos: number | null; reserved: boolean }>()

const emit = defineEmits<{
  (e: 'set', binding: Binding): void
  (e: 'revert'): void
}>()

const keymap = useKeymapStore()

const canWrite = computed(
  () => props.pos !== null && !props.reserved && keymap.editingId !== LAYER_ID_INVALID,
)

const staged = computed(() => props.pos !== null && keymap.isPending(keymap.editingSlot, props.pos))

function stage(binding: Binding): void {
  if (!canWrite.value) return
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
      <button
        class="chip"
        :disabled="!canWrite"
        title="&trans — this layer inherits the key from the layer below"
        @click="stage({ token: TRANSPARENT_TOKEN, param1: 0, param2: 0 })"
      >
        &amp;trans
      </button>
      <button
        class="chip"
        :disabled="!canWrite"
        title="&none — this key does nothing on this layer"
        @click="stage({ token: NONE_TOKEN, param1: 0, param2: 0 })"
      >
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

.cell {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
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
</style>
