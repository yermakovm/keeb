/**
 * Layout store: per-layer key bindings for the matrix.
 *
 * Cell addressing: `${side}.${row}.${col}` with side 'L' | 'R'.
 * Display mapping (see KeyboardView): both halves render cols left→right,
 * so the LEFT half reads outward from the gap and the RIGHT half reads
 * inward (col 0 is the gap-side column on the right half). This matches
 * the physical wiring of the 6x6-per-half bring-up board.
 *
 * Override model (Oryx-style): a layer holds only the cells it overrides.
 * Resolution walks down to layer 0. A cell with no binding on any layer
 * renders as "inherit" (only possible when layer 0 lacks a binding).
 *
 * Bindings are plain JSON objects (kind + params) — the same shape that
 * will be encoded into TLV records for the BLE transfer.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { MOCK_BINDINGS, UNWIRED_CELLS } from '../data/mock.js'

export const cellKey = (side, row, col) => `${side}.${row}.${col}`

export const useLayoutStore = defineStore('layout', () => {
  /** layers[layerIndex][cellKey] = binding | (missing = inherit) */
  const bindings = ref(MOCK_BINDINGS.map((l) => ({ ...l })))

  /** Cells not wired to the matrix for this board (6x6 default only). */
  const unwired = ref(new Set(UNWIRED_CELLS))

  function ensureLayer(layerCount) {
    while (bindings.value.length < layerCount) bindings.value.push({})
    // trimming happens in the component tree via config layer count
  }

  function isWired(side, row, col) {
    return !unwired.value.has(cellKey(side, row, col))
  }

  /** Resolve a binding for the given layer, walking down to layer 0. */
  function resolve(layerIndex, side, row, col) {
    const k = cellKey(side, row, col)
    for (let l = layerIndex; l >= 0; l--) {
      const b = bindings.value[l]?.[k]
      if (b) return b
    }
    return null
  }

  /** Which layer actually defines the resolved binding (for UI hints). */
  function definingLayer(layerIndex, side, row, col) {
    const k = cellKey(side, row, col)
    for (let l = layerIndex; l >= 0; l--) {
      if (bindings.value[l]?.[k]) return l
    }
    return -1
  }

  /** True when the active layer carries its own binding for the cell. */
  function isOwnOverride(layerIndex, side, row, col) {
    return !!bindings.value[layerIndex]?.[cellKey(side, row, col)]
  }

  function setBinding(layerIndex, side, row, col, binding) {
    ensureLayer(layerIndex + 1)
    const k = cellKey(side, row, col)
    if (binding) bindings.value[layerIndex][k] = binding
    else delete bindings.value[layerIndex][k]
  }

  /** Remove the active layer's override so the cell inherits again. */
  function clearBinding(layerIndex, side, row, col) {
    delete bindings.value[layerIndex]?.[cellKey(side, row, col)]
  }

  function serialize() {
    return bindings.value.map((l) => ({ ...l }))
  }

  function hydrate(layers) {
    if (Array.isArray(layers)) bindings.value = layers.map((l) => ({ ...l }))
  }

  function resetToMock() {
    bindings.value = MOCK_BINDINGS.map((l) => ({ ...l }))
    unwired.value = new Set(UNWIRED_CELLS)
  }

  return {
    bindings, unwired, isWired, resolve, definingLayer, isOwnOverride,
    setBinding, clearBinding, serialize, hydrate, resetToMock,
  }
})
