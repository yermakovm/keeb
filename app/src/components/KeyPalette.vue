<!--
  Keycode palette — Oryx-style stepped binding.

  Everything you can bind lives in one place under the keyboard.  Categories
  are the first step; inside a category you either pick an item directly or
  walk through a short param chain (layer → keycode, modifier → keycode, …).

  The palette never hides the grid: it is under it, so the cap you clicked and
  the chip you are about to click are both visible at once.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'

import { CATALOG } from '../data/keycodes.ts'
import { paramKinds } from '../model/cap.ts'
import { KEYCODES, TOKENS } from '../proto/zmk.gen.ts'
import type { Binding } from '../proto/types.ts'
import { useDeviceStore } from '../stores/device.ts'
import { LAYER_ID_INVALID, useKeymapStore } from '../stores/keymap.ts'

const props = defineProps<{ pos: number | null; reserved: boolean }>()

const emit = defineEmits<{
  (e: 'set', binding: Binding): void
}>()

const device = useDeviceStore()
const keymap = useKeymapStore()

/* ---------------------------------------------------------------- categories */

const KINDS: Array<{ id: string; title: string; groups: string[]; note: string }> = [
  { id: 'letters', title: 'letters · numbers', groups: ['letters', 'numbers'], note: '' },
  { id: 'symbols', title: 'symbols', groups: ['symbols', 'shifted'], note: '' },
  { id: 'modifiers', title: 'modifiers', groups: ['modifiers'], note: '' },
  { id: 'navigation', title: 'navigation', groups: ['navigation'], note: '' },
  { id: 'function', title: 'function · keypad', groups: ['function', 'keypad'], note: '' },
  { id: 'media', title: 'media', groups: ['media'], note: '' },
  { id: 'layers', title: 'layers', groups: [], note: 'mo · to · tog · sl' },
  { id: 'dual', title: 'dual-function', groups: [], note: 'lt · mt · gresc' },
  { id: 'system', title: 'system', groups: [], note: 'reset · bt · out · caps' },
  { id: 'mouse', title: 'mouse', groups: [], note: 'mkp · mmv · msc' },
]

const GROUP_TITLE: Record<string, string> = {
  letters: 'letters',
  numbers: 'numbers',
  symbols: 'symbols',
  shifted: 'shifted',
  modifiers: 'modifiers',
  navigation: 'navigation',
  function: 'F1–F12',
  keypad: 'keypad',
  media: 'media',
  mouseButtons: 'buttons',
  mouseMove: 'move',
  mouseScroll: 'scroll',
}

const KEYCODE_GROUPS = Object.keys(CATALOG)

/* ---------------------------------------------------------------- tabs */

const TAB_IDS = ['keycodes', 'behaviors'] as const
type TabId = (typeof TAB_IDS)[number]

const TAB_KINDS: Record<TabId, string[]> = {
  keycodes: ['letters', 'symbols', 'modifiers', 'navigation', 'function', 'media'],
  behaviors: ['layers', 'dual', 'system', 'mouse'],
}

const tab = ref<TabId>('keycodes')

/* ---------------------------------------------------------------- state */

const kindId = ref<string | null>(null)
const wrap = ref<'kp' | 'kt' | 'sk'>('kp')
const query = ref('')

/* stepped binding state */
const pickedToken = ref<number | null>(null)
const paramValues = ref<[number, number]>([0, 0])
const paramStep = ref(0)

const WRAP_NOTE: Record<typeof wrap.value, string> = {
  kp: 'tap',
  kt: 'sticky-off toggle',
  sk: 'sticky key',
}

/* ---------------------------------------------------------------- helpers */

const readyIds = computed(() => new Set(device.readyTokens.map((t) => t.token)))
const hasDeviceTokens = computed(() => device.tokens.length > 0)

const usable = (token: number): boolean => !hasDeviceTokens.value || readyIds.value.has(token)

const canWrite = computed(
  () => props.pos !== null && !props.reserved && keymap.editingId !== LAYER_ID_INVALID,
)

const kind = computed(() => KINDS.find((k) => k.id === kindId.value) ?? null)
const wrapToken = computed(() => TOKENS.find((t) => t.label === wrap.value))

/* ---------------------------------------------------------------- token lookups */

function tokenByLabel(label: string): number | null {
  const t = TOKENS.find((x) => x.label === label)
  return t && usable(t.id) ? t.id : null
}

/* ---------------------------------------------------------------- stepped flow helpers */

function startToken(label: string) {
  const id = tokenByLabel(label)
  if (id === null) return
  pickedToken.value = id
  paramValues.value = [0, 0]
  paramStep.value = 0
}

function setParam(value: number) {
  const next: [number, number] = [...paramValues.value] as [number, number]
  next[paramStep.value] = value >>> 0
  paramValues.value = next
  paramStep.value++

  const kinds = paramKinds(pickedToken.value!)
  if (paramStep.value >= kinds.length) {
    stage({ token: pickedToken.value!, param1: next[0], param2: next[1] })
    reset()
  }
}

function cancelStep() {
  pickedToken.value = null
  paramValues.value = [0, 0]
  paramStep.value = 0
}

/* ---------------------------------------------------------------- keycodes */

const groupsFor = computed(() =>
  (kind.value ? kind.value.groups : KEYCODE_GROUPS).map((id) => ({
    id,
    title: GROUP_TITLE[id] ?? id,
    items: CATALOG[id as keyof typeof CATALOG],
  })),
)

const q = computed(() => query.value.trim().toUpperCase())

const matches = (item: { name: string; label: string }): boolean =>
  !q.value.length || item.name.includes(q.value) || item.label.toUpperCase().includes(q.value)

const sections = computed(() =>
  groupsFor.value
    .map((g) => ({
      title: g.title,
      items: g.items
        .filter(matches)
        .map((item) => ({
          id: `${g.id}:${item.name}`,
          main: item.label,
          sub: item.name,
          binding: { token: wrapToken.value!.id, param1: item.code, param2: 0 } as Binding,
        })),
    }))
    .filter((s) => s.items.length > 0),
)

const total = computed(() => sections.value.reduce((n, s) => n + s.items.length, 0))

/* ---------------------------------------------------------------- step machine */

/* kind      → category grid
 * choices   → normal keycode groups (letters, symbols, …)
 * token     → choose a specific token (layer ops, dual-function ops, system ops)
 * param     → fill the next parameter for the chosen token
 */
type FlowStep = 'kind' | 'choices' | 'token' | 'param'

const flow = computed<FlowStep>(() => {
  if (pickedToken.value !== null) return 'param'
  if (kind.value?.id === 'layers' || kind.value?.id === 'dual' || kind.value?.id === 'system' || kind.value?.id === 'mouse') return 'token'
  return kind.value || q.value.length ? 'choices' : 'kind'
})

/* ---------------------------------------------------------------- system tokens */

const SYSTEM_TOKENS = ['sys_reset', 'bootloader', 'right_reset', 'right_boot', 'caps_word', 'key_repeat', 'layer_art']
const MOUSE_TOKENS = ['mkp', 'mmv', 'msc']

const systemItems = computed(() =>
  SYSTEM_TOKENS.map((label) => {
    const t = TOKENS.find((x) => x.label === label)
    if (!t || !usable(t.id)) return null
    const k = paramKinds(t.id)
    return { label, name: t.displayName ?? t.name, token: t.id, hasParams: k.length > 0 }
  }).filter(Boolean) as Array<{ label: string; name: string; token: number; hasParams: boolean }>,
)

/* ---------------------------------------------------------------- layer tokens */

const LAYER_OPS = ['mo', 'to', 'tog', 'sl']

const layerOps = computed(() =>
  LAYER_OPS.map((label) => {
    const t = TOKENS.find((x) => x.label === label)
    if (!t || !usable(t.id)) return null
    return { label, name: t.displayName ?? t.name, token: t.id }
  }).filter(Boolean) as Array<{ label: string; name: string; token: number }>,
)

/* ---------------------------------------------------------------- dual tokens */

const DUAL_OPS = ['lt', 'mt', 'hml', 'hmr', 'gresc']

const dualOps = computed(() =>
  DUAL_OPS.map((label) => {
    const t = TOKENS.find((x) => x.label === label)
    if (!t || !usable(t.id)) return null
    return { label, name: t.displayName ?? t.name, token: t.id }
  }).filter(Boolean) as Array<{ label: string; name: string; token: number }>,
)

const mouseOps = computed(() =>
  MOUSE_TOKENS.map((label) => {
    const t = TOKENS.find((x) => x.label === label)
    if (!t || !usable(t.id)) return null
    return { label, name: t.displayName ?? t.name, token: t.id }
  }).filter(Boolean) as Array<{ label: string; name: string; token: number }>,
)

/* ---------------------------------------------------------------- tab filtering */

const tabKinds = computed(() =>
  q.value.length ? KINDS : KINDS.filter((k) => TAB_KINDS[tab.value].includes(k.id)),
)

/* ---------------------------------------------------------------- param UI data */

const currentParamKind = computed(() => {
  if (pickedToken.value === null) return null
  const kinds = paramKinds(pickedToken.value)
  return kinds[paramStep.value] ?? null
})

const currentParamLabel = computed(() => {
  const kind = currentParamKind.value
  if (!kind) return ''
  switch (kind) {
    case 'keycode': return 'keycode'
    case 'layer': return 'layer'
    case 'mouse-vector': return 'direction'
    case 'button-mask': return 'buttons'
    case 'bt-cmd': return 'command'
    case 'output': return 'output'
    default: return `param${paramStep.value + 1}`
  }
})

const layerSlots = computed(() => keymap.slots.filter((s) => s.id !== LAYER_ID_INVALID))

const keySearch = ref('')

const keycodeHits = computed(() => {
  const qv = keySearch.value.trim().toUpperCase()
  const all = Object.values(CATALOG).flat()
  if (!qv) return all
  return all.filter((k) => k.name.includes(qv) || k.label.toUpperCase().includes(qv)).slice(0, 30)
})

/* ---------------------------------------------------------------- breadcrumb */

const crumbs = computed(() => {
  const out: Array<{ id: string | null; label: string }> = [{ id: null, label: 'category' }]
  if (kind.value) out.push({ id: 'kind', label: kind.value.title })
  if (pickedToken.value !== null) {
    const def = TOKENS.find((t) => t.id === pickedToken.value)
    out.push({ id: 'token', label: def ? `&${def.label}` : 'token' })
  }
  return out
})

function crumb(id: string | null): void {
  if (id === null) { reset(); return }
  if (id === 'kind') { cancelStep(); kindId.value = null; return }
}

function back(): void {
  if (pickedToken.value !== null) { cancelStep(); return }
  if (q.value.length) { query.value = ''; return }
  kindId.value = null
}

function reset(): void {
  kindId.value = null
  query.value = ''
  cancelStep()
}

function pickKind(id: string): void {
  kindId.value = id
  cancelStep()
}

function stage(c: Binding): void {
  if (!canWrite.value) return
  emit('set', c)
}

/* ---------------------------------------------------------------- bt / out / mouse helpers */

const BT_ITEMS = [
  { v: 0, label: 'clear profile' },
  { v: 1, label: 'next profile' },
  { v: 2, label: 'previous profile' },
  { v: 3, label: 'select profile' },
  { v: 4, label: 'clear all bonds' },
  { v: 5, label: 'disconnect' },
]

const OUT_ITEMS = [
  { v: 0, label: 'toggle' },
  { v: 1, label: 'USB' },
  { v: 2, label: 'BLE' },
  { v: 3, label: 'none' },
]

const MOVE_ITEMS = ['MOVE_UP', 'MOVE_DOWN', 'MOVE_LEFT', 'MOVE_RIGHT']
const SCRL_ITEMS = ['SCRL_UP', 'SCRL_DOWN', 'SCRL_LEFT', 'SCRL_RIGHT']
const BUTTON_ITEMS = ['LCLK', 'RCLK', 'MCLK', 'MB4', 'MB5']

</script>

<template>
  <section class="palette">
    <header class="phead">
      <h2>keys</h2>

      <nav class="crumbs" aria-label="where you are in the catalog">
        <button
          v-for="(c, i) in crumbs"
          :key="c.label"
          class="crumb"
          :class="{ here: i === crumbs.length - 1 }"
          @click="crumb(c.id)"
        >
          {{ c.label }}
        </button>
      </nav>

      <label class="find">
        <input
          v-model="query"
          class="search"
          type="search"
          placeholder="PRINTSCREEN · caps_word"
          aria-label="narrow the keycodes by name or label"
        />
      </label>

      <span v-if="flow === 'choices'" class="count" aria-live="polite">{{ total }} shown</span>

      <span class="target">
        <template v-if="pos === null">no key selected</template>
        <template v-else>→ position {{ pos }} · {{ keymap.editingName }}</template>
      </span>

      <button class="chip back" :disabled="flow === 'kind' && !query" title="one step back" @click="back">back</button>
    </header>

    <p v-if="reserved" class="note bad">position {{ pos }} is reserved: the firmware will not rebind it</p>

    <!-- ================================================================
         STEP 1 — Category grid (with tabs)
         ================================================================ -->
    <template v-if="flow === 'kind'">
      <div class="tabs">
        <button
          v-for="t in TAB_IDS"
          :key="t"
          class="tab"
          :class="{ on: tab === t }"
          @click="tab = t"
        >
          {{ t === 'keycodes' ? 'Keys' : 'Behaviors' }}
        </button>
      </div>

      <div class="grid">
        <button
          v-for="k in tabKinds"
          :key="k.id"
          class="big"
          :disabled="pos === null || reserved"
          @click="pickKind(k.id)"
        >
          {{ k.title }}
          <small>{{ k.note || `${k.groups.length} groups` }}</small>
        </button>
      </div>
    </template>

    <!-- ================================================================
         STEP 2a — Normal keycode groups (letters, symbols, modifiers, …)
         ================================================================ -->
    <div v-else-if="flow === 'choices'" class="choices">
      <div class="variants">
        <span class="vlabel">variant</span>
        <button
          v-for="w in (['kp', 'kt', 'sk'] as const)"
          :key="w"
          class="chip"
          :class="{ on: wrap === w }"
          :title="`&${w} — ${WRAP_NOTE[w]}`"
          @click="wrap = w"
        >
          &amp;{{ w }}
        </button>
        <span v-if="wrapToken && !usable(wrapToken.id)" class="note bad">
          the keyboard did not report &amp;{{ wrap }} as available
        </span>
      </div>

      <section v-for="s in sections" :key="s.title" class="group">
        <h3>{{ s.title }} <small>{{ s.items.length }}</small></h3>
        <div class="keys">
          <button
            v-for="c in s.items"
            :key="c.id"
            class="key"
            :disabled="!canWrite"
            :title="`stage ${c.main} at position ${pos}`"
            @click="stage(c.binding)"
          >
            {{ c.main }}
            <small>{{ c.sub }}</small>
          </button>
        </div>
      </section>

      <p v-if="!sections.length" class="note">nothing in the catalog matches “{{ query }}”</p>
    </div>

    <!-- ================================================================
         STEP 2b — Token selection (layers, dual-function, system)
         ================================================================ -->
    <div v-else-if="flow === 'token'" class="choices">
      <!-- layers -->
      <template v-if="kind?.id === 'layers'">
        <section class="group">
          <h3>layer operation <small>{{ layerOps.length }}</small></h3>
          <div class="keys">
            <button
              v-for="op in layerOps"
              :key="op.label"
              class="key"
              :disabled="!canWrite"
              @click="startToken(op.label)"
            >
              &amp;{{ op.label }}
              <small>{{ op.name }}</small>
            </button>
          </div>
        </section>
      </template>

      <!-- dual-function -->
      <template v-if="kind?.id === 'dual'">
        <section class="group">
          <h3>dual-function <small>{{ dualOps.length }}</small></h3>
          <div class="keys">
            <button
              v-for="op in dualOps"
              :key="op.label"
              class="key"
              :disabled="!canWrite"
              @click="startToken(op.label)"
            >
              &amp;{{ op.label }}
              <small>{{ op.name }}</small>
            </button>
          </div>
        </section>
      </template>

      <!-- system -->
      <template v-if="kind?.id === 'system'">
        <section class="group">
          <h3>immediate <small>{{ systemItems.filter((x) => !x.hasParams).length }}</small></h3>
          <div class="keys">
            <button
              v-for="op in systemItems.filter((x) => !x.hasParams)"
              :key="op.label"
              class="key"
              :disabled="!canWrite"
              @click="stage({ token: op.token, param1: 0, param2: 0 })"
            >
              &amp;{{ op.label }}
              <small>{{ op.name }}</small>
            </button>
          </div>
        </section>

        <section class="group">
          <h3>with parameters <small>{{ systemItems.filter((x) => x.hasParams).length }}</small></h3>
          <div class="keys">
            <button
              v-for="op in systemItems.filter((x) => x.hasParams)"
              :key="op.label"
              class="key"
              :disabled="!canWrite"
              @click="startToken(op.label)"
            >
              &amp;{{ op.label }}
              <small>{{ op.name }}</small>
            </button>
          </div>
        </section>
      </template>

      <!-- mouse -->
      <template v-if="kind?.id === 'mouse'">
        <section class="group">
          <h3>mouse <small>{{ mouseOps.length }}</small></h3>
          <div class="keys">
            <button
              v-for="op in mouseOps"
              :key="op.label"
              class="key"
              :disabled="!canWrite"
              @click="startToken(op.label)"
            >
              &amp;{{ op.label }}
              <small>{{ op.name }}</small>
            </button>
          </div>
        </section>
      </template>
    </div>

    <!-- ================================================================
         STEP 3 — Parameter fill
         ================================================================ -->
    <div v-else-if="flow === 'param'" class="choices">
      <div class="param-head">
        <b>&amp;{{ TOKENS.find((t) => t.id === pickedToken)?.label ?? '?' }}</b>
        <span class="note">{{ currentParamLabel }} (param {{ paramStep + 1 }})</span>
        <button class="chip small" @click="cancelStep">change token</button>
      </div>

      <!-- layer param -->
      <template v-if="currentParamKind === 'layer'">
        <div class="chips">
          <button
            v-for="l in layerSlots"
            :key="l.id"
            class="chip layer"
            :class="{ live: l.live }"
            :disabled="!canWrite"
            @click="setParam(l.id)"
          >
            {{ l.name }}
          </button>
        </div>
      </template>

      <!-- keycode param -->
      <template v-else-if="currentParamKind === 'keycode'">
        <input v-model="keySearch" class="search" placeholder="search keycodes…" spellcheck="false" />
        <div class="keys">
          <button
            v-for="k in keycodeHits"
            :key="k.name"
            class="key"
            @click="setParam(k.code)"
          >
            {{ k.label }}
            <small>{{ k.name }}</small>
          </button>
        </div>
        <p v-if="keySearch && !keycodeHits.length" class="note">no matches</p>
      </template>

      <!-- mouse vector param -->
      <template v-else-if="currentParamKind === 'mouse-vector'">
        <div class="keys">
          <button
            v-for="n in (TOKENS.find((t) => t.id === pickedToken)?.label === 'msc' ? SCRL_ITEMS : MOVE_ITEMS)"
            :key="n"
            class="key"
            @click="setParam(KEYCODES[n] ?? 0)"
          >
            {{ n.replace(/^MOVE_/, '').replace(/^SCRL_/, '') }}
            <small>{{ n }}</small>
          </button>
        </div>
      </template>

      <!-- button mask param -->
      <template v-else-if="currentParamKind === 'button-mask'">
        <div class="chips">
          <button
            v-for="(n, i) in BUTTON_ITEMS"
            :key="n"
            class="chip"
            :class="{ on: ((paramValues[0] ?? 0) & (1 << i)) !== 0 }"
            @click="setParam((paramValues[0] ?? 0) ^ (1 << i))"
          >
            {{ n }}
          </button>
        </div>
      </template>

      <!-- bt command param -->
      <template v-else-if="currentParamKind === 'bt-cmd'">
        <div class="keys">
          <button
            v-for="b in BT_ITEMS"
            :key="b.v"
            class="key"
            @click="setParam(b.v)"
          >
            {{ b.label }}
            <small>BT {{ b.v }}</small>
          </button>
        </div>
      </template>

      <!-- output param -->
      <template v-else-if="currentParamKind === 'output'">
        <div class="keys">
          <button
            v-for="o in OUT_ITEMS"
            :key="o.v"
            class="key"
            @click="setParam(o.v)"
          >
            {{ o.label }}
          </button>
        </div>
      </template>

      <!-- plain number param -->
      <template v-else>
        <input
          class="num"
          type="number"
          :value="paramValues[paramStep] ?? 0"
          @change="setParam(Number(($event.target as HTMLInputElement).value))"
        />
      </template>
    </div>
  </section>
</template>

<style scoped>
.palette {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--line);
  background: var(--panel);
  padding: 14px 14px 12px;
  min-width: 0;
  min-height: 0;
}

.phead {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink);
}

.crumbs { display: flex; gap: 4px; align-items: center; }

.crumb {
  border: 0;
  background: transparent;
  color: var(--mid);
  font: inherit;
  font-size: 12px;
  padding: 2px 4px;
  cursor: pointer;
}

.crumb::after { content: ' ›'; color: var(--line); }
.crumb:last-child::after { content: none; }
.crumb:hover { color: var(--ink); }
.crumb.here { color: var(--mid); font-weight: 400; }

.target {
  margin-left: auto;
  font-size: 12px;
  color: var(--mid);
}

.find {
  flex: 0 1 170px;
  min-width: 110px;
}

.count { font-size: 12px; color: var(--mid); }

.note { margin: 0; font-size: 12px; color: var(--mid); }
.note.bad { color: var(--err); }

.chip {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--mid);
  font: inherit;
  font-size: 12px;
  padding: 3px 8px;
  cursor: pointer;
}

.chip:hover:not(:disabled) { color: var(--ink); border-color: var(--ink); }
.chip.on { background: var(--mod); color: var(--ink); border-color: var(--ink); font-weight: 700; }
.chip:disabled { opacity: 0.62; cursor: not-allowed; }
.chip.small { font-size: 11px; }
.chip.layer {
  font-weight: 700;
  color: var(--ink);
  min-width: 46px;
}
.chip.layer.live { background: var(--soft); }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 6px;
}

.big {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid var(--line);
  background: var(--bg-inset);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  padding: 8px 10px;
  cursor: pointer;
}

.big small { color: var(--mid); font-size: 11px; }
.big:hover:not(:disabled) { background: var(--ink); color: var(--on-ink); }
.big:hover:not(:disabled) small { color: var(--on-ink); opacity: 0.75; }
.big:disabled { opacity: 0.62; cursor: not-allowed; }

.choices {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.group h3 {
  margin: 0;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mid);
}

.group h3 small { color: var(--soft); }

.variants {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.vlabel {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mid);
}

.keys {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(58px, 1fr));
  gap: 4px;
}

.key {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  padding: 5px 4px;
  cursor: pointer;
}

.key small { font-size: 9px; color: var(--mid); }

.key:hover:not(:disabled) {
  background: var(--ink);
  color: var(--on-ink);
  border-color: var(--ink);
}

.key:hover:not(:disabled) small { color: var(--on-ink); opacity: 0.75; }
.key:disabled { opacity: 0.62; cursor: not-allowed; }

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.search {
  width: 100%;
  border: 1px solid var(--line);
  background: var(--bg-inset);
  color: var(--ink);
  font-family: var(--mono);
  font-size: 12px;
  padding: 3px 6px;
}

.search:focus { border-color: var(--ink); }

.param-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13px;
}

.num {
  width: 120px;
  padding: 5px 8px;
  border: 1px solid var(--line);
  background: var(--bg-inset);
  color: var(--ink);
  font-family: var(--mono);
  font-size: 12px;
}

.tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--line);
}

.tab {
  padding: 6px 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--mid);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tab:hover { color: var(--ink); }

.tab.on {
  color: var(--ink);
  border-bottom-color: var(--ink);
  font-weight: 700;
}
</style>