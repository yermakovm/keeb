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
  <div class="tabs">
    <div
      v-for="slot in keymap.slots"
      :key="slot.index"
      class="tab"
      :class="{ on: keymap.editingSlot === slot.index, empty: slot.id === LAYER_ID_INVALID, live: slot.live }"
      @click="slot.id !== LAYER_ID_INVALID && (keymap.editingSlot = slot.index)"
    >
      <span class="idx" :title="`slot ${slot.index} → layer id ${slot.id}`">{{ slot.index }}</span>

      <template v-if="slot.id !== LAYER_ID_INVALID">
        <input
          v-if="keymap.editingSlot === slot.index"
          class="rename"
          :value="slot.name"
          spellcheck="false"
          @change="rename(slot.index, ($event.target as HTMLInputElement).value)"
          @blur="rename(slot.index, ($event.target as HTMLInputElement).value)"
        />
        <span v-else class="name">{{ slot.name }}</span>

        <span v-if="slot.live" class="live" title="active on the keyboard">●</span>
        <span v-if="slot.locked" class="locked" title="locked by TO/TOG">🔒</span>
        <span v-if="slot.dirty" class="dirty" title="uncommitted edits">+{{ slot.dirty }}</span>

        <span class="arrows">
          <button class="mini" title="move slot left" @click.stop="move(slot.index, -1)">←</button>
          <button class="mini" title="move slot right" @click.stop="move(slot.index, 1)">→</button>
          <button class="mini danger" title="remove this layer slot" @click.stop="remove(slot.index)">×</button>
        </span>
      </template>

      <span v-else class="name empty-name">empty</span>
    </div>

    <button class="add" title="take the next unused layer slot" @click="add">+</button>

    <span v-if="notice" class="notice">{{ notice }}</span>
  </div>
</template>

<style scoped>
.tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.tab {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 8px 8px 3px 3px;
  background: var(--bg-raised);
  color: var(--text-dim);
  font-weight: 700; font-size: 12px; letter-spacing: 0.4px;
  cursor: pointer;
}

.tab:hover { color: var(--text); }
.tab.on { background: var(--bg-panel); color: var(--text); border-color: var(--accent); box-shadow: 0 2px 12px -6px var(--accent); }
.tab.empty { border-style: dashed; opacity: 0.55; cursor: default; }
.tab.live { border-bottom-color: var(--ok); }

.idx { font-size: 10px; color: var(--text-faint); }
.name { min-width: 34px; text-align: center; }
.empty-name { font-weight: 400; }

.rename {
  width: 62px; padding: 0 3px; border: none; background: transparent;
  color: inherit; font: inherit; text-align: center;
  border-bottom: 1px dashed var(--accent);
}

.live { color: var(--ok); font-size: 10px; }
.locked { font-size: 9px; }
.dirty { color: var(--warn); font-size: 10px; }

.arrows { display: flex; gap: 2px; }
.mini {
  padding: 0 4px; font-size: 11px; line-height: 1.4;
  border: 1px solid var(--border); border-radius: 4px;
  color: var(--text-faint); background: transparent;
}
.mini:hover { color: var(--accent); border-color: var(--accent); }
.mini.danger:hover { color: var(--err); border-color: var(--err); }

.add {
  width: 30px; height: 30px; border-radius: 8px;
  border: 1px dashed var(--border); color: var(--text-faint);
  font-size: 16px;
}
.add:hover { color: var(--accent); border-color: var(--accent); }

.notice { color: var(--err); font-size: 11px; }
</style>
