<script setup lang="ts">
/*
 * Layer rail - the vertical slot picker on the left of the board.
 *
 * One warm button per slot holding only the slot's index; the layer's name sits
 * on a line beneath the button. The active slot is lit warm.
 *
 * The controls hang on the active slot itself: ▲ / ▼ move the layer up and
 * down (beside the button), and a small × pill sits in its top-right corner to
 * remove the layer. A trailing ＋ is the last option and creates a new layer.
 */
import { computed, ref } from 'vue'

import { LAYER_ID_INVALID, useKeymapStore } from '../stores/keymap.ts'
import type { WriteResult } from '../stores/keymap.ts'

const keymap = useKeymapStore()
const notice = ref('')

const editingSlot = computed(() => keymap.editingSlot)
const editing = computed(() => keymap.slots[editingSlot.value] ?? null)
const editingValid = computed(
  () => editing.value != null && editing.value.id !== LAYER_ID_INVALID,
)

/** A slot is "active" when it is the one being edited and actually has a layer. */
const isActive = (slot: { index: number; id: number }): boolean =>
  slot.index === editingSlot.value && slot.id !== LAYER_ID_INVALID

/** A layer operation can succeed over the wire and still be unpersisted. */
const outcome = (r: WriteResult, label: string): string => {
  if (!r.ok) {
    return r.reason ?? `${label} failed`
  }

  return r.saveReason ? `${label} applied, save failed: ${r.saveReason}` : ''
}

function select(index: number): void {
  const slot = keymap.slots[index]
  if (slot && slot.id !== LAYER_ID_INVALID) {
    keymap.editingSlot = index
  }
}

async function rename(value: string): Promise<void> {
  if (!editingValid.value) {
    return
  }

  const r = await keymap.renameLayer(editingSlot.value, value)

  notice.value = outcome(r, 'rename')
}

async function move(delta: number): Promise<void> {
  const to = editingSlot.value + delta

  if (to < 0 || to >= keymap.capacity) {
    return
  }

  const r = await keymap.moveLayer(editingSlot.value, to)

  notice.value = outcome(r, 'move')
}

async function add(): Promise<void> {
  const r = await keymap.addLayer()

  notice.value = outcome(r, 'add')
}

async function remove(): Promise<void> {
  if (!editingValid.value) {
    return
  }

  const r = await keymap.removeLayer(editingSlot.value)

  notice.value = outcome(r, 'remove')
}
</script>

<template>
  <aside class="rail" aria-label="Layer">
    <div class="rail-list" role="group" aria-label="Layer slots">
      <div
        v-for="slot in keymap.slots"
        :key="slot.index"
        class="rail-slot"
        :class="{
          editing: editingSlot === slot.index,
          empty: slot.id === LAYER_ID_INVALID,
        }"
        :title="slot.id !== LAYER_ID_INVALID ? `edit slot ${slot.index} — ${slot.name}` : `slot ${slot.index} is empty`"
        @click="select(slot.index)"
      >
        <div class="slot-row">
          <div class="btn-wrap">
            <button
              class="rail-btn"
              :aria-pressed="editingSlot === slot.index"
              :disabled="slot.id === LAYER_ID_INVALID"
              :title="slot.id !== LAYER_ID_INVALID ? `edit slot ${slot.index} — ${slot.name}` : `slot ${slot.index} is empty`"
              @click="select(slot.index)"
            >
              {{ slot.index }}
              <span v-if="slot.live" class="live" title="active on the keyboard" />
              <span v-if="slot.locked" class="lock" title="locked by TO/TOG">🔒</span>
              <span v-if="slot.dirty" class="dirty" title="uncommitted edits">+{{ slot.dirty }}</span>
            </button>

            <!-- A small × pill saddling the active slot button's top-right corner. -->
            <span
              v-if="isActive(slot)"
              class="rm-pill"
              role="button"
              tabindex="0"
              title="remove this layer"
              @click.stop="remove"
              @keydown.enter.prevent="remove"
            >×</span>
          </div>

          <!-- Move the active layer up or down: the controls sit beside it. -->
          <div v-if="isActive(slot)" class="move">
            <button
              class="move-btn"
              :disabled="slot.index <= 0"
              title="move layer up"
              @click.stop="move(-1)"
            >▲</button>
            <button
              class="move-btn"
              :disabled="slot.index >= keymap.capacity - 1"
              title="move layer down"
              @click.stop="move(1)"
            >▼</button>
          </div>
        </div>

        <span class="rail-name">
          <input
            v-if="isActive(slot)"
            class="rename"
            :value="slot.name"
            spellcheck="false"
            aria-label="layer name"
            @change="rename(($event.target as HTMLInputElement).value)"
            @blur="rename(($event.target as HTMLInputElement).value)"
          />
          <template v-else>{{ slot.id === LAYER_ID_INVALID ? 'empty' : slot.name }}</template>
        </span>
      </div>

      <!-- The last option: ＋ creates a new layer. -->
      <button class="rail-add" title="take the next unused layer slot" @click="add">＋</button>
    </div>

    <p v-if="notice" class="notice">{{ notice }}</p>
  </aside>
</template>

<style scoped>
.rail {
  flex: none;
  width: 98px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rail-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rail-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

/* The slot button is centred on the rail axis (via .rail-slot), so all buttons
 * line up; the move controls hang off its right side without shifting it. */
.slot-row {
  position: relative;
}

/* A box exactly the button's size, so the × pill can saddle the button's
 * top-right corner without reaching over the move controls. */
.btn-wrap {
  position: relative;
}


/* A rounded warm button that holds only the slot index. */
.rail-btn {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: var(--panel-raised);
  border: 1px solid var(--line);
  color: var(--mid);
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  position: relative;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease;
}

.rail-btn:hover:not(:disabled) {
  color: var(--ink);
  border-color: var(--ink);
}

.rail-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

/* The slot you are editing is lit green, with the same accent glow the
 * selected keycap uses. */
.rail-slot.editing .rail-btn {
  background: rgba(110, 231, 160, 0.18);
  border-color: rgba(110, 231, 160, 0.65);
  color: #6ee7a0;
  box-shadow: 0 0 22px rgba(110, 231, 160, 0.35);
}

/* Move up / down: a small vertical pair that floats to the left of the
 * centred button, so the active button stays aligned with the rest. */
.move {
  position: absolute;
  right: calc(100% + 4px);
  top: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.move-btn {
  width: 22px;
  height: 20px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: transparent;
  color: var(--mid);
  font: inherit;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}

.move-btn:hover:not(:disabled) { color: var(--ink); border-color: var(--ink); }
.move-btn:disabled { opacity: 0.35; cursor: default; }

/* The remove pill saddles the active slot button's top-right corner. */
.rm-pill {
  position: absolute;
  top: -7px;
  right: -7px;
  width: 19px;
  height: 19px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--panel);
  border: 1px solid var(--line);
  color: var(--mid);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.rm-pill:hover { color: var(--err); border-color: var(--err); }

.rail-name {
  max-width: 100%;
  font-size: 11px;
  color: var(--mid);
  text-align: center;
  line-height: 1.2;
  word-break: break-word;
}

.rail-slot.editing .rail-name {
  color: var(--ink);
}

/* The active slot's name is an editable line so renaming keeps working. */
.rename {
  width: 100%;
  padding: 1px 2px;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 11px;
  text-align: center;
}

/* Markers on the button: live dot, lock, staged count. */
.live,
.lock,
.dirty {
  position: absolute;
}

.live {
  left: 5px;
  bottom: 5px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 6px var(--ok);
}

.lock {
  right: 4px;
  bottom: 3px;
  font-size: 8px;
}

.dirty {
  right: 5px;
  top: 4px;
  font-size: 9px;
  color: var(--warn);
  font-weight: 700;
}

.rail-btn:disabled .live {
  background: var(--mid);
  box-shadow: none;
}

/* The trailing ＋ is the last option and creates a new layer. */
.rail-add {
  width: 34px;
  height: 34px;
  margin: 2px auto 0;
  border-radius: 10px;
  border: 1px dashed var(--line);
  background: transparent;
  color: var(--mid);
  font: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.rail-add:hover { color: var(--ink); border-color: var(--ink); }

.notice {
  margin: 0;
  font-size: 11px;
  color: var(--err);
  word-break: break-word;
}

@media (max-width: 600px) {
  .rail {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .rail-list {
    flex-direction: row;
    flex-wrap: wrap;
  }
}
</style>