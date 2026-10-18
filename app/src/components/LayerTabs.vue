<script setup>
import { useConfigStore } from '../stores/config.js'

const config = useConfigStore()
</script>

<template>
  <div class="tabs">
    <button
      v-for="l in config.layers"
      :key="l.index"
      class="tab"
      :class="{ on: config.activeLayer === l.index }"
      :style="{ '--c': l.color }"
      :title="`Edit layer ${l.name}`"
      @click="config.activeLayer = l.index"
    >
      <span class="dot" :style="{ background: l.color }" />
      <input
        v-if="config.activeLayer === l.index"
        class="rename"
        :value="l.name"
        spellcheck="false"
        @change="config.renameLayer(l.index, $event.target.value)"
        @blur="config.renameLayer(l.index, $event.target.value)"
      />
      <span v-else class="name">{{ l.name }}</span>
    </button>
    <button class="add" title="Add layer" @click="config.addLayer()">+</button>
  </div>
</template>

<style scoped>
.tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tab {
  display: flex; align-items: center; gap: 7px;
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 8px 8px 3px 3px;
  background: var(--bg-raised);
  color: var(--text-dim);
  font-weight: 700; font-size: 12px; letter-spacing: 0.5px;
}
.tab:hover { color: var(--text); }
.tab.on {
  background: var(--bg-panel); color: var(--text);
  border-color: var(--c); box-shadow: 0 2px 12px -6px var(--c);
}
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.name { min-width: 24px; text-align: center; }
.rename {
  width: 52px; padding: 0 3px; border: none; background: transparent;
  color: inherit; font: inherit; text-align: center;
  border-bottom: 1px dashed var(--c);
}
.add {
  width: 30px; height: 30px; border-radius: 8px;
  border: 1px dashed var(--border); color: var(--text-faint);
  font-size: 16px;
}
.add:hover { color: var(--accent); border-color: var(--accent); }
</style>
