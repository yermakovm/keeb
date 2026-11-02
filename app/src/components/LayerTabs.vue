<script setup lang="ts">
/*
 * Layer slots, not a layer list.
 *
 * ZMK's reordering moves *slots* (order[slot] = layer id). The id is what the
 * cells belong to and what a MO/TO binding points at, so both are shown: a tab
 * says "slot 2 · FUN" and marks the layer the keyboard currently has active.
 */
import { ref } from 'vue'

import { LAYER_ID_INVALID, useKeymapStore } from '../stores/keymap.ts'
import type { WriteResult } from '../stores/keymap.ts'

const keymap = useKeymapStore()
const notice = ref('')

/** A layer operation can succeed over the wire and still be unpersisted, which
 * is the half the user cannot see from the tab moving: ZMK saves the layer
 * order and the names with the same SAVE a rebound key needs.
 */
const outcome = (r: WriteResult, label: string): string => {
  if (!r.ok) {
    return r.reason ?? `${label} failed`
  }

  return r.saveReason ? `${label} applied, save failed: ${r.saveReason}` : ''
}

async function rename(index: number, value: string): Promise<void> {
  const r = await keymap.renameLayer(index, value)

  notice.value = outcome(r, 'rename')
}

async function move(index: number, delta: number): Promise<void> {
  const to = index + delta

  if (to < 0 || to >= keymap.capacity) {
    return
  }

  const r = await keymap.moveLayer(index, to)

  notice.value = outcome(r, 'move')
}

async function add(): Promise<void> {
  const r = await keymap.addLayer()

  notice.value = outcome(r, 'add')
}

async function remove(index: number): Promise<void> {
  const r = await keymap.removeLayer(index)

  notice.value = outcome(r, 'remove')
}
</script>

<template>
  <div class="tabs-wrapper">
    <div class="tabs" role="group" aria-label="Layer">
      <button
        v-for="slot in keymap.slots"
        :key="slot.index"
        :aria-pressed="keymap.editingSlot === slot.index"
        :disabled="slot.id === LAYER_ID_INVALID"
        :class="['tab', { empty: slot.id === LAYER_ID_INVALID, live: slot.live, dirty: slot.dirty }]"
        :title="slot.id !== LAYER_ID_INVALID ? `slot ${slot.index} → layer id ${slot.id}` : 'empty slot'"
        @click="slot.id !== LAYER_ID_INVALID && (keymap.editingSlot = slot.index)"
      >
        {{ slot.index }}
      </button>
    </div>

    <div class="layer-info" v-if="keymap.slots[keymap.editingSlot]?.id !== LAYER_ID_INVALID">
      <input
        v-if="keymap.editingSlot !== null"
        class="rename"
        :value="keymap.slots[keymap.editingSlot]?.name ?? ''"
        spellcheck="false"
        @change="rename(keymap.editingSlot, ($event.target as HTMLInputElement).value)"
        @blur="rename(keymap.editingSlot, ($event.target as HTMLInputElement).value)"
      />
      <span v-if="keymap.slots[keymap.editingSlot]?.live" class="live" title="active on the keyboard">●</span>
      <span v-if="keymap.slots[keymap.editingSlot]?.locked" class="locked" title="locked by TO/TOG">🔒</span>
      <span v-if="keymap.slots[keymap.editingSlot]?.dirty" class="dirty" title="uncommitted edits">+{{ keymap.slots[keymap.editingSlot]?.dirty }}</span>
    </div>

    <div class="layer-ctrl">
      <button class="ctrl" title="move slot left" @click="move(keymap.editingSlot, -1)">←</button>
      <button class="ctrl" title="move slot right" @click="move(keymap.editingSlot, 1)">→</button>
      <button class="ctrl danger" title="remove this layer slot" @click="remove(keymap.editingSlot)">×</button>
      <button class="ctrl add" title="take the next unused layer slot" @click="add">+</button>
    </div>

    <span v-if="notice" class="notice">{{ notice }}</span>
  </div>
</template>

<style scoped>
.tabs-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* A segmented control: one box, hairline dividers, the active segment lifted by
 * an accent underline rather than a fill. The live dot stays ink on purpose -
 * the underline says "this is the layer you are editing", the dot says "this is
 * the layer the keyboard is actually running", and those are different facts. */
.tabs {
  display: flex;
  border: 1px solid var(--line);
  overflow: hidden;
}

.tab {
  width: 40px;
  padding: 3px 0;
  background: transparent;
  border: 0;
  border-right: 1px solid var(--line);
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
  position: relative;
}

.tab:last-child {
  border-right: 0;
}

.tab[aria-pressed="true"] {
  background: var(--mod);
  box-shadow: inset 0 -3px 0 var(--accent);
  font-weight: 700;
}

.tab:disabled {
  opacity: 0.3;
  cursor: default;
}

.tab:hover:not(:disabled) {
  background: var(--mod);
}

.tab.live::after {
  content: '';
  position: absolute;
  bottom: 1px;
  left: 50%;
  transform: translateX(-50%);
  width: 5px;
  height: 2px;
  background: var(--ink);
}

.layer-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rename {
  width: 80px;
  padding: 3px 6px;
  border: none;
  border-bottom: 1px dashed var(--mid);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  text-align: center;
}

.rename:focus {
  outline: none;
  border-bottom-style: solid;
}

.live { color: var(--ink); font-size: 10px; }
.locked { font-size: 9px; }
.dirty { color: var(--warn); font-size: 10px; }

.layer-ctrl {
  display: flex;
  gap: 4px;
}

.ctrl {
  padding: 2px 8px;
  font-size: 12px;
  line-height: 1.4;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--mid);
  font: inherit;
  cursor: pointer;
}

.ctrl:hover { color: var(--ink); border-color: var(--mid); }
.ctrl.danger:hover { color: var(--err); border-color: var(--err); }
.ctrl.add { font-weight: 700; }

.notice { color: var(--err); font-size: 11px; }
</style>
