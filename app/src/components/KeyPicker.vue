<script setup>
import { ref, computed } from 'vue'
import { useConfigStore } from '../stores/config.js'
import { PICKER_GROUPS, keyLabel } from '../data/keycodes.js'
import Keycap from './Keycap.vue'

const props = defineProps({
  /** { side, row, col, binding(resolved), own } */
  cell: { type: Object, required: true },
})
const emit = defineEmits(['set', 'clear', 'close'])

const config = useConfigStore()

/** Extra categories built from live config layers. */
const CUSTOM = new Set(['layers', 'holdtap'])
const categories = [
  ...PICKER_GROUPS,
  { id: 'layers', title: 'Layers', items: [] },
  { id: 'holdtap', title: 'Hold/Tap', items: [] },
]

const activeCat = ref('letters')
const search = ref('')
/** Pending follow-up selection: { mode: 'layer-for-mo'|'layer-for-to'|'layer-for-lt'|'mod-for-hml'|'mod-for-hmr' } */
const pending = ref(null)

/** The tap key reused when creating hold/tap behaviors from an existing cap. */
const currentTap = computed(() => {
  const b = props.cell.binding
  if (!b) return 'SPACE'
  if (b.kind === 'key') return b.code
  if (b.tap) return b.tap
  return 'SPACE'
})

const MOD_LEFT = ['LGUI', 'LALT', 'LCTRL', 'LSHFT']
const MOD_RIGHT = ['RGUI', 'RALT', 'RCTRL', 'RSHFT']

const filtered = computed(() => {
  const items = categories.find((c) => c.id === activeCat.value)?.items ?? []
  const q = search.value.trim().toUpperCase()
  if (!q) return items
  return items.filter((i) => i.code.includes(q) || i.label.toUpperCase().includes(q.toUpperCase()))
})

function selectItem(item) {
  const kind = item.kind ?? 'key'
  if (kind === 'key' || kind === 'mkp' || kind === 'mmv' || kind === 'msc') {
    emit('set', { kind, code: item.code })
    return
  }
  if (kind === 'MO') { pending.value = { mode: 'mo' }; return }
  if (kind === 'TO') { pending.value = { mode: 'to' }; return }
  if (kind === 'LT') { pending.value = { mode: 'lt' }; return }
  if (kind === 'HML') { pending.value = { mode: 'hml' }; return }
  if (kind === 'HMR') { pending.value = { mode: 'hmr' }; return }
}

function pickLayer(layerIndex) {
  const m = pending.value.mode
  if (m === 'mo') emit('set', { kind: 'mo', layer: layerIndex })
  else if (m === 'to') emit('set', { kind: 'to', layer: layerIndex })
  else if (m === 'lt') emit('set', { kind: 'lt', layer: layerIndex, tap: currentTap.value })
  pending.value = null
}

function pickMod(hold) {
  const m = pending.value.mode
  emit('set', { kind: m, tap: currentTap.value, hold })
  pending.value = null
}

/** Layer-behavior + hold/tap pseudo-items for the custom categories. */
function customItems(catId) {
  if (catId === 'layers') {
    return [
      ...config.layers.map((l) => ({ code: `MO_${l.name}`, label: `MO ${l.name}`, kind: 'MO' })),
      ...config.layers.map((l) => ({ code: `TO_${l.name}`, label: `TO ${l.name}`, kind: 'TO' })),
    ]
  }
  return [
    { code: 'LT', label: 'LT (hold = layer)', kind: 'LT' },
    { code: 'HML', label: 'HML (left-hand mod hold)', kind: 'HML' },
    { code: 'HMR', label: 'HMR (right-hand mod hold)', kind: 'HMR' },
  ]
}

const displayItems = computed(() => {
  if (CUSTOM.has(activeCat.value)) {
    const items = customItems(activeCat.value)
    const q = search.value.trim().toUpperCase()
    return q ? items.filter((i) => i.label.toUpperCase().includes(q.toUpperCase())) : items
  }
  return filtered.value
})

const pendingLabel = computed(() => {
  switch (pending.value?.mode) {
    case 'mo': return 'Choose layer for MO:'
    case 'to': return 'Choose layer for TO:'
    case 'lt': return 'Choose hold layer for LT:'
    case 'hml': return 'Choose hold modifier (left-hand):'
    case 'hmr': return 'Choose hold modifier (right-hand):'
    default: return null
  }
})
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="picker">
      <div class="head">
        <div class="cell-info">
          <span class="pos">{{ cell.side === 'L' ? 'LEFT' : 'RIGHT' }} · row {{ cell.row }} · col {{ cell.col }}</span>
          <span class="on">editing layer {{ config.layers[config.activeLayer]?.name }}</span>
          <span v-if="!cell.own" class="inh">inherited — pick a binding to override</span>
          <span v-else class="own">override on this layer</span>
        </div>
        <div class="preview" v-if="cell.binding">
          <Keycap :binding="cell.binding" wired own />
        </div>
      </div>

      <div v-if="pendingLabel" class="pending">
        <span>{{ pendingLabel }}</span>
        <template v-if="['mo', 'to', 'lt'].includes(pending.mode)">
          <button v-for="l in config.layers" :key="l.index" class="chip" :style="{ '--c': l.color }" @click="pickLayer(l.index)">
            {{ l.name }}
          </button>
        </template>
        <template v-else>
          <button v-for="m in (pending.mode === 'hml' ? MOD_LEFT : MOD_RIGHT)" :key="m" class="chip" @click="pickMod(m)">
            {{ keyLabel(m) }}
          </button>
        </template>
        <button class="chip cancel" @click="pending = null">cancel</button>
      </div>

      <div class="body">
        <div class="cats">
          <button
            v-for="c in categories" :key="c.id"
            class="cat" :class="{ on: activeCat === c.id }"
            @click="activeCat = c.id; pending = null"
          >{{ c.title }}</button>
        </div>

        <div class="items-wrap">
          <input v-model="search" placeholder="Search keys… (e.g. LCTRL, F5, SCRL)" />
          <div class="items">
            <button v-for="item in displayItems" :key="item.code" class="item" @click="selectItem(item)">
              {{ item.label }}
            </button>
            <p v-if="!displayItems.length" class="empty">No matches.</p>
          </div>
        </div>
      </div>

      <div class="foot">
        <button class="btn danger" :disabled="!cell.own" @click="emit('clear')">
          Remove override (inherit)
        </button>
        <button class="btn" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(2px);
}
.picker {
  width: min(760px, 92vw);
  max-height: 85vh;
  display: flex; flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
}
.head {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 18px; border-bottom: 1px solid var(--border-soft);
}
.cell-info { display: flex; flex-direction: column; gap: 3px; flex: 1; }
.pos { font-weight: 700; }
.on { color: var(--accent); font-size: 12px; }
.inh { color: var(--text-dim); font-size: 12px; }
.own { color: var(--accent-dim); font-size: 12px; }
.preview { width: 64px; }
.preview :deep(.cap) { cursor: default; }

.pending {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding: 10px 18px; background: var(--bg-inset);
  border-bottom: 1px solid var(--border-soft); font-size: 12px;
}
.chip {
  padding: 5px 12px; border-radius: 20px;
  border: 1px solid var(--border); background: var(--bg-raised);
  font-size: 12px;
}
.chip:hover { border-color: var(--accent); }
.chip.cancel { color: var(--text-dim); }

.body { display: flex; min-height: 0; }
.cats {
  width: 120px; padding: 12px 8px;
  display: flex; flex-direction: column; gap: 4px;
  border-right: 1px solid var(--border-soft);
}
.cat {
  text-align: left; padding: 7px 10px; border-radius: 6px;
  color: var(--text-dim); font-size: 12px;
}
.cat:hover { background: var(--bg-raised); color: var(--text); }
.cat.on { background: var(--bg-raised); color: var(--accent); font-weight: 600; }

.items-wrap { flex: 1; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.items-wrap input { width: 100%; }
.items {
  overflow-y: auto; min-height: 120px; max-height: 36vh;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 6px; padding: 2px;
}
.item {
  padding: 9px 4px; border-radius: 7px;
  background: linear-gradient(160deg, var(--cap-key-top), var(--cap-key));
  border: 1px solid var(--border);
  font-size: 11px; font-weight: 600;
  box-shadow: 0 2px 0 rgba(0,0,0,0.4);
}
.item:hover { border-color: var(--accent); filter: brightness(1.2); }
.empty { grid-column: 1 / -1; color: var(--text-faint); text-align: center; }

.foot {
  display: flex; justify-content: space-between; gap: 10px;
  padding: 12px 18px; border-top: 1px solid var(--border-soft);
}
.btn {
  padding: 7px 16px; border-radius: 7px;
  border: 1px solid var(--border); background: var(--bg-raised);
}
.btn:hover { border-color: var(--accent); }
.btn.danger { color: #e08a78; }
.btn:disabled { opacity: 0.4; cursor: default; }
</style>
