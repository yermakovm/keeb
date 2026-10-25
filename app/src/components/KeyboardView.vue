<script setup lang="ts">
/*
 * The grid, drawn where the keys actually are.
 *
 * Positions come from the matrix transform's map (keeb.dtsi), and the map is
 * written in physical order: the left half lists columns 0-5 from its outer
 * edge to the split gap, the right half lists 11-6 from the gap to its outer
 * edge. `gridHalf()` reproduces that order, so a cap lands in the same slot it
 * occupies on the board, and the position number a CELLS record carries means
 * the same key here and in the firmware.
 *
 * Each half is drawn as the full 6 columns it has room for. A row that the
 * transform maps shorter - the 2-key extra row at cols 2-3, the 4-key thumb row
 * at cols 2-5 - keeps its columns instead of collapsing to the left, and the
 * grid slots with no switch render as dashed placeholders.
 */
import { computed, ref } from 'vue'

import Keycap from './Keycap.vue'
import { describeBinding } from '../model/cap.ts'
import { GRID_ROWS, HALF_COLS, gridHalf, type GridSlot, useKeymapStore } from '../stores/keymap.ts'
import { KEY_COUNT } from '../proto/zmk.gen.ts'

const props = defineProps<{ selectedPos: number | null }>()

const emit = defineEmits<{ (e: 'pick', pos: number, own: boolean): void }>()

const keymap = useKeymapStore()

/** Print the stock position number in every cap, for when the number on the
 * keyboard and the number in a CELLS record have to be matched by eye. */
const showPositions = ref(false)

interface CapCell {
  pos: number
  display: ReturnType<typeof describeBinding>
  own: boolean
  reserved: boolean
  selected: boolean
  pending: boolean
}

interface SlotView {
  slot: GridSlot
  cell: CapCell | null
}

const rows = computed(() => {
  const out: Array<{ row: number; left: SlotView[]; right: SlotView[] }> = []

  for (let row = 0; row < GRID_ROWS; row++) {
    const mk = (slot: GridSlot): SlotView => {
      if (slot.pos === null) {
        return { slot, cell: null }
      }

      const pos = slot.pos
      const own = keymap.ownCell(keymap.editingSlot, pos) !== null
      const resolved = keymap.resolve(keymap.editingSlot, pos)

      return {
        slot,
        cell: {
          pos,
          display: describeBinding(resolved?.binding ?? null, keymap.layerName),
          own,
          reserved: keymap.isReserved(pos),
          selected: props.selectedPos === pos,
          pending: keymap.isPending(keymap.editingSlot, pos),
        },
      }
    }

    out.push({
      row,
      left: gridHalf(row, 'L').map(mk),
      right: gridHalf(row, 'R').map(mk),
    })
  }

  return out
})

const layerLabel = computed(() => keymap.editingName)
const positions = computed(() => KEY_COUNT)

const slotTitle = (slot: { row: number; col: number }): string =>
  `matrix row ${slot.row} col ${slot.col}: no switch wired here, so this grid slot has no key position`
</script>

<template>
  <div class="keyboard" :style="{ '--layer-color': 'var(--accent)' }">
    <div class="head">
      <div class="cols">
        {{ positions }} stock positions · {{ GRID_ROWS }}×{{ HALF_COLS * 2 }} matrix grid · editing slot
        {{ keymap.editingSlot }}
        <template v-if="keymap.editingId !== 0xff"> ({{ layerLabel }})</template>
      </div>

      <button
        class="btn pos-toggle"
        :class="{ on: showPositions }"
        :title="showPositions ? 'hide the stock position numbers' : 'print the stock position number on every cap - the number a CELLS record uses'"
        @click="showPositions = !showPositions"
      >
        positions
      </button>
    </div>

    <div v-for="line in rows" :key="line.row" class="row">
      <div class="half left" :style="{ '--cols': HALF_COLS }">
        <template v-for="{ slot, cell } in line.left" :key="`L${line.row}-${slot.col}`">
          <Keycap
            v-if="cell"
            :pos="cell.pos"
            :display="cell.display"
            :own="cell.own"
            :reserved="cell.reserved"
            :selected="cell.selected"
            :pending="cell.pending"
            :show-pos="showPositions"
            :layer-label="layerLabel"
            @pick="(pos) => emit('pick', pos, cell.own)"
          />
          <div v-else class="slot" :title="slotTitle(slot)" />
        </template>
      </div>

      <div class="gap" />

      <div class="half right" :style="{ '--cols': HALF_COLS }">
        <template v-for="{ slot, cell } in line.right" :key="`R${line.row}-${slot.col}`">
          <Keycap
            v-if="cell"
            :pos="cell.pos"
            :display="cell.display"
            :own="cell.own"
            :reserved="cell.reserved"
            :selected="cell.selected"
            :pending="cell.pending"
            :show-pos="showPositions"
            :layer-label="layerLabel"
            @pick="(pos) => emit('pick', pos, cell.own)"
          />
          <div v-else class="slot" :title="slotTitle(slot)" />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.keyboard {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  padding: 20px;
  background: var(--bg-raised);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.cols {
  color: var(--text-faint);
  font-size: 11px;
}

.btn.pos-toggle {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  padding: 3px 9px;
}

.btn.pos-toggle:hover { border-color: var(--border-strong); color: var(--text-dim); }
.btn.pos-toggle.on { border-color: var(--accent); color: var(--accent); }

.row { display: flex; align-items: flex-start; justify-content: center; }

.gap { width: var(--split-gap); }

.half {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(44px, 60px));
  gap: var(--gap);
}

/* A grid slot the transform does not map to a switch. */
.slot {
  aspect-ratio: 1 / 1;
  border: 1px dashed var(--border);
  border-radius: 7px;
  opacity: 0.45;
}
</style>
