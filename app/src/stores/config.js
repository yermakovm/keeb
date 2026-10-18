/**
 * Config store: board parameters (split, rows, cols) and the layer list.
 * All state is plain JSON so it can be serialized to TLV for BLE later.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { MOCK_CONFIG } from '../data/mock.js'

const LAYER_COLORS = ['#e0a158', '#5ea87c', '#6c9ce8', '#4fb7ae', '#c878b4', '#8f78e0', '#d9705f', '#58b5d9']

export const useConfigStore = defineStore('config', () => {
  const split = ref(MOCK_CONFIG.split)
  const rows = ref(MOCK_CONFIG.rows)
  const cols = ref(MOCK_CONFIG.cols)
  const layers = ref(MOCK_CONFIG.layers.map((l, i) => ({ ...l, index: i })))
  /** Layer currently being edited (also the layer shown on the keyboard). */
  const activeLayer = ref(0)

  const totalKeys = computed(() => rows.value * cols.value * (split.value ? 2 : 1))

  function setLayerCount(n) {
    n = Math.max(1, Math.min(32, n))
    while (layers.value.length < n) {
      const i = layers.value.length
      layers.value.push({ name: `L${i}`, color: LAYER_COLORS[i % LAYER_COLORS.length], index: i })
    }
    while (layers.value.length > n) layers.value.pop()
    if (activeLayer.value >= layers.value.length) activeLayer.value = layers.value.length - 1
  }

  function renameLayer(index, name) {
    const l = layers.value[index]
    if (l) l.name = name.toUpperCase().slice(0, 8) || l.name
  }

  function addLayer() {
    setLayerCount(layers.value.length + 1)
  }

  function removeLayer(index) {
    if (index === 0 || layers.value.length <= 1) return
    layers.value.splice(index, 1)
    layers.value.forEach((l, i) => (l.index = i))
    if (activeLayer.value >= layers.value.length) activeLayer.value = layers.value.length - 1
  }

  function setRows(n) {
    rows.value = Math.max(1, Math.min(15, n))
  }

  function setCols(n) {
    cols.value = Math.max(1, Math.min(15, n))
  }

  /** JSON snapshot — future TLV payload source. */
  function serialize() {
    return {
      split: split.value,
      rows: rows.value,
      cols: cols.value,
      layers: layers.value.map(({ name, color }) => ({ name, color })),
    }
  }

  function hydrate(obj) {
    if (!obj) return
    split.value = !!obj.split
    rows.value = obj.rows ?? rows.value
    cols.value = obj.cols ?? cols.value
    if (Array.isArray(obj.layers) && obj.layers.length) {
      layers.value = obj.layers.map((l, i) => ({
        name: l.name,
        color: l.color ?? LAYER_COLORS[i % LAYER_COLORS.length],
        index: i,
      }))
    }
  }

  return { split, rows, cols, layers, activeLayer, totalKeys,
    setLayerCount, renameLayer, addLayer, removeLayer, setRows, setCols, serialize, hydrate }
})
