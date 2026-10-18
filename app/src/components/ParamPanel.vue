<script setup>
import { ref } from 'vue'
import { useConfigStore } from '../stores/config.js'
import { useLayoutStore } from '../stores/layout.js'

const config = useConfigStore()
const layout = useLayoutStore()

const showJson = ref(false)
const jsonDump = ref('')

function dump() {
  jsonDump.value = JSON.stringify(
    { config: config.serialize(), bindings: layout.serialize() },
    null, 2,
  )
  showJson.value = true
}

function reset() {
  config.hydrate({ split: true, rows: 6, cols: 6,
    layers: [
      { name: 'HOME', color: '#e0a158' }, { name: 'NAV', color: '#5ea87c' },
      { name: 'FUN', color: '#6c9ce8' }, { name: 'MOUSE', color: '#4fb7ae' },
      { name: 'MEDIA', color: '#c878b4' },
    ] })
  layout.resetToMock()
}
</script>

<template>
  <div class="panel">
    <label class="field split-toggle">
      <input type="checkbox" v-model="config.split" />
      <span>Split</span>
    </label>

    <label class="field">
      <span>Rows</span>
      <input type="number" min="1" max="15" :value="config.rows"
        @input="config.setRows(+$event.target.value)" />
    </label>

    <label class="field">
      <span>Cols</span>
      <input type="number" min="1" max="15" :value="config.cols"
        @input="config.setCols(+$event.target.value)" />
    </label>

    <label class="field">
      <span>Layers</span>
      <input type="number" min="1" max="32" :value="config.layers.length"
        @input="config.setLayerCount(+$event.target.value)" />
    </label>

    <span class="keys" title="Total matrix keys">{{ config.totalKeys }} keys</span>

    <span class="spacer" />

    <button class="btn" title="Dump current state as JSON (future TLV payload)" @click="dump">JSON</button>
    <button class="btn" title="Discard changes and reload the mock layout" @click="reset">Reset</button>

    <div v-if="showJson" class="json-overlay" @click.self="showJson = false">
      <div class="json-box">
        <h3>Configurator state <small>(TLV payload source)</small></h3>
        <pre>{{ jsonDump }}</pre>
        <button class="btn" @click="showJson = false">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
}
.field { display: flex; align-items: center; gap: 6px; color: var(--text-dim); font-size: 12px; }
.field input[type='number'] { width: 58px; }
.split-toggle input { accent-color: var(--accent); width: 15px; height: 15px; }
.split-toggle { cursor: pointer; user-select: none; }
.keys { color: var(--text-faint); font-size: 12px; }
.spacer { flex: 1; }
.btn {
  padding: 6px 14px; border-radius: 7px;
  border: 1px solid var(--border); background: var(--bg-raised);
  font-size: 12px;
}
.btn:hover { border-color: var(--accent); color: var(--accent); }

.json-overlay {
  position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.json-box {
  width: min(700px, 90vw); max-height: 80vh; display: flex; flex-direction: column; gap: 10px;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px;
}
.json-box h3 { margin: 0; font-size: 14px; }
.json-box small { color: var(--text-faint); font-weight: 400; }
.json-box pre {
  flex: 1; overflow: auto; margin: 0; padding: 12px;
  background: var(--bg-inset); border-radius: 8px;
  font-size: 11px; line-height: 1.5;
}
.json-box .btn { align-self: flex-end; }
</style>
