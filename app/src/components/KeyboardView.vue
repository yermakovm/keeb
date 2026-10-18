<script setup>
import { computed } from 'vue'
import { useConfigStore } from '../stores/config.js'
import { useLayoutStore, cellKey } from '../stores/layout.js'
import Keycap from './Keycap.vue'
import { enrichBinding } from '../data/enrich.js'

const props = defineProps({ selectedCell: { type: String, default: null } })
const emit = defineEmits(['pick'])

const config = useConfigStore()
const layout = useLayoutStore()


/**
 * Build the visual grid. When split, each matrix row renders as two halves
 * separated by the gap. Both halves render col 0..cols-1 left→right; the
 * LEFT half's last col and the RIGHT half's first col face the gap.
 * When not split, only the left half is shown (single side).
 */
const gridRows = computed(() => {
  const rows = []
  for (let r = 0; r < config.rows; r++) {
    const line = { left: [], right: [] }
    for (let c = 0; c < config.cols; c++) {
      const key = (side) => cellKey(side, r, c)
      const mk = (side) => {
        const k = key(side)
        const binding = enrichBinding(layout.resolve(config.activeLayer, side, r, c), config.layers)
        return {
          k,
          side,
          row: r,
          col: c,
          binding,
          wired: layout.isWired(side, r, c),
          own: layout.isOwnOverride(config.activeLayer, side, r, c),
          selected: props.selectedCell === k,
        }
      }
      line.left.push(mk('L'))
      if (config.split) line.right.push(mk('R'))
    }
    rows.push(line)
  }
  return rows
})

const layerName = computed(() => config.layers[config.activeLayer]?.name ?? '')
</script>

<template>
  <div class="keyboard">
    <div v-for="line in gridRows" :key="line.left[0].row" class="row">
      <div class="half left">
        <Keycap
          v-for="cell in line.left"
          :key="cell.k"
          v-bind="cell"
          :layer-name="layerName"
          @pick="emit('pick', cell)"
        />
      </div>
      <div v-if="config.split" class="half right">
        <Keycap
          v-for="cell in line.right"
          :key="cell.k"
          v-bind="cell"
          :layer-name="layerName"
          @pick="emit('pick', cell)"
        />
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
.row { display: flex; gap: var(--split-gap); justify-content: center; }
.half {
  display: grid;
  grid-template-columns: repeat(v-bind('config.cols'), minmax(44px, 64px));
  gap: var(--gap);
}
</style>
