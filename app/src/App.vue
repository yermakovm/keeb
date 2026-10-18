<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useConfigStore } from './stores/config.js'
import { useLayoutStore } from './stores/layout.js'
import KeyboardView from './components/KeyboardView.vue'
import LayerTabs from './components/LayerTabs.vue'
import ParamPanel from './components/ParamPanel.vue'
import KeyPicker from './components/KeyPicker.vue'
import { enrichBinding } from './data/enrich.js'

const config = useConfigStore()
const layout = useLayoutStore()

/** Currently picked cell for the binding menu, or null. */
const picked = ref(null)

function onPick(cell) {
  picked.value = {
    side: cell.side, row: cell.row, col: cell.col,
    binding: cell.binding, own: cell.own,
  }
}

function refresh(c, own) {
  picked.value = {
    ...c,
    binding: enrichBinding(layout.resolve(config.activeLayer, c.side, c.row, c.col), config.layers),
    own,
  }
}

function onSet(binding) {
  const c = picked.value
  layout.setBinding(config.activeLayer, c.side, c.row, c.col, binding)
  refresh(c, layout.isOwnOverride(config.activeLayer, c.side, c.row, c.col))
}

function onClear() {
  const c = picked.value
  layout.clearBinding(config.activeLayer, c.side, c.row, c.col)
  refresh(c, false)
}

const pickedKey = computed(() =>
  picked.value ? `${picked.value.side}.${picked.value.row}.${picked.value.col}` : null)

// Keep layout bindings in sync with the layer count.
watch(() => config.layers.length, (n) => {
  while (layout.bindings.length > n) layout.bindings.pop()
  while (layout.bindings.length < n) layout.bindings.push({})
})

// --- persistence (localStorage now, TLV-over-BLE later — same JSON shape) ---
const LS_KEY = 'keeb-configurator-v1'
let saveTimer
watch([() => config, () => layout.bindings], () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        config: config.serialize(), bindings: layout.serialize(),
      }))
    } catch { /* storage full / unavailable — ignore */ }
  }, 400)
}, { deep: true })

onMounted(() => {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const obj = JSON.parse(raw)
    config.hydrate(obj.config)
    layout.hydrate(obj.bindings)
  } catch { /* corrupted state — keep the mock */ }
})
</script>

<template>
  <div class="app">
    <header>
      <h1>keeb <span>configurator</span></h1>
      <ParamPanel />
    </header>

    <LayerTabs class="tabs" />

    <main>
      <KeyboardView :selected-cell="pickedKey" @pick="onPick" />
      <aside class="legend">
        <div><b>Ring</b> = override on the edited layer</div>
        <div><b>Dimmed</b> = inherited from a lower layer</div>
        <div><b>Dashed</b> = cell not wired to the matrix</div>
        <div>Diagonal caps = hold/tap (hold top-right, tap bottom-left)</div>
      </aside>
    </main>

    <KeyPicker
      v-if="picked"
      :cell="picked"
      @set="onSet"
      @clear="onClear"
      @close="picked = null"
    />
  </div>
</template>

<style scoped>
.app { max-width: 1200px; margin: 0 auto; padding: 18px 24px 40px; }

header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 20px; flex-wrap: wrap; margin-bottom: 18px;
}
h1 { margin: 0; font-size: 18px; letter-spacing: 1px; }
h1 span { color: var(--text-dim); font-weight: 400; }

.tabs { margin-bottom: 14px; }

main { display: flex; flex-direction: column; gap: 12px; }
.legend {
  display: flex; gap: 18px; flex-wrap: wrap;
  color: var(--text-faint); font-size: 11.5px;
}
.legend b { color: var(--text-dim); font-weight: 600; }
</style>
