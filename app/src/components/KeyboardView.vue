<script setup lang="ts">
/*
 * The grid, drawn in stock positions.
 *
 * Left half is global columns 0-5, right half 6-11, and the position numbers
 * run in the matrix transform's map order (keeb.dtsi), which is the numbering
 * every CELLS record uses. Rows are not uniform: the extra row has 2 keys per
 * half and the thumb row 4, exactly as the transform maps them.
 */
import { computed } from 'vue'

import Keycap from './Keycap.vue'
import { describeBinding } from '../model/cap.ts'
import { GRID_ROWS, gridSide, useKeymapStore } from '../stores/keymap.ts'
import { KEY_COUNT } from '../proto/zmk.gen.ts'

const props = defineProps<{ selectedPos: number | null }>()

const emit = defineEmits<{ (e: 'pick', pos: number, own: boolean): void }>()

const keymap = useKeymapStore()

interface CapCell {
  pos: number
  display: ReturnType<typeof describeBinding>
  own: boolean
  reserved: boolean
  unmapped: boolean
  selected: boolean
}

const rows = computed(() => {
  const out: Array<{ row: number; left: CapCell[]; right: CapCell[] }> = []

  for (let row = 0; row < GRID_ROWS; row++) {
    const mk = (pos: number, unmapped: boolean): CapCell => {
      const own = keymap.ownCell(keymap.editingSlot, pos) !== null
      const resolved = keymap.resolve(keymap.editingSlot, pos)

      return {
        pos,
        display: describeBinding(resolved?.binding ?? null, keymap.layerName),
        own,
        reserved: keymap.isReserved(pos),
        unmapped,
        selected: props.selectedPos === pos,
      }
    }

    const line = { row, left: [] as CapCell[], right: [] as CapCell[] }

    for (const g of gridSide(row, 'L')) {
      line.left.push(mk(g.pos, false))
    }

    /* A half with fewer mapped slots than the widest row renders short, which
     * is the honest picture of the matrix transform. */
    for (const g of gridSide(row, 'R')) {
      line.right.push(mk(g.pos, false))
    }

    out.push(line)
  }

  return out
})

const maxCols = computed(() => Math.max(...rows.value.map((r) => r.left.length), 1))
const rightCols = computed(() => Math.max(...rows.value.map((r) => r.right.length), 1))
const layerLabel = computed(() => keymap.editingName)
const positions = computed(() => KEY_COUNT)
</script>

<template>
  <div class="keyboard" :style="{ '--layer-color': 'var(--accent)' }">
    <div v-for="line in rows" :key="line.row" class="row">
      <div class="half left" :style="{ '--cols': maxCols }">
        <Keycap
          v-for="cell in line.left"
          :key="cell.pos"
          :pos="cell.pos"
          :display="cell.display"
          :own="cell.own"
          :reserved="cell.reserved"
          :unmapped="cell.unmapped"
          :selected="cell.selected"
          :dimmed="false"
          :layer-label="layerLabel"
          @pick="(pos) => emit('pick', pos, cell.own)"
        />
      </div>

      <div class="gap" />

      <div class="half right" :style="{ '--cols': rightCols }">
        <Keycap
          v-for="cell in line.right"
          :key="cell.pos"
          :pos="cell.pos"
          :display="cell.display"
          :own="cell.own"
          :reserved="cell.reserved"
          :unmapped="cell.unmapped"
          :selected="cell.selected"
          :dimmed="false"
          :layer-label="layerLabel"
          @pick="(pos) => emit('pick', pos, cell.own)"
        />
      </div>
    </div>

    <div class="footnote">
      {{ positions }} stock positions · editing slot {{ keymap.editingSlot }}
      <template v-if="keymap.editingId !== 0xff"> ({{ layerLabel }}) </template>
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

.row { display: flex; align-items: flex-start; justify-content: center; }

.gap { width: var(--split-gap); }

.half {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(44px, 60px));
  gap: var(--gap);
}

.footnote {
  margin-top: 6px;
  color: var(--text-faint);
  font-size: 11px;
}
</style>
