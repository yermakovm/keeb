<!--
  Keycode dock — the Stage reference's floating tray under the keyboard.

  Collapsed it is just a pill: a search field and a row of category buttons.
  Clicking a category grows the dock upward into a panel that rises from the
  bottom — a light, translucent tray ~a third of the screen tall, so the board
  stays fully visible above it while you assign keys. The panel carries the
  category's keys as keycap-shaped tiles with sub-groups (numbers, F-keys,
  numpad, …) as tabs along its top edge.

  Assigning: select a key on the board, then click a tile (or drag one onto a
  cap). Search replaces the category view with results across every category.

  Closing: Esc, clicking the open category again, or clicking empty space
  collapses it back to the dock.
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { CATALOG } from '../data/keycodes.ts'
import { paramKinds } from '../model/cap.ts'
import { KEYCODES, TOKENS } from '../proto/zmk.gen.ts'
import type { Binding } from '../proto/types.ts'
import { useDeviceStore } from '../stores/device.ts'
import { LAYER_ID_INVALID, useKeymapStore } from '../stores/keymap.ts'

const props = withDefaults(
  defineProps<{ pos: number | null; reserved: boolean; busy?: boolean }>(),
  { reserved: false, busy: false },
)

const emit = defineEmits<{
  (e: 'set', binding: Binding): void
  (e: 'apply'): void
  (e: 'revert'): void
  (e: 'save'): void
  (e: 'discard'): void
}>()

const device = useDeviceStore()
const keymap = useKeymapStore()

/* ---------------------------------------------------------------- categories */

const KINDS: Array<{ id: string; title: string; short: string; groups: string[]; note: string }> = [
  { id: 'letters', title: 'letters · numbers', short: 'Letters', groups: ['letters', 'numbers'], note: '' },
  { id: 'symbols', title: 'symbols', short: 'Symbols', groups: ['symbols', 'shifted'], note: '' },
  { id: 'modifiers', title: 'modifiers', short: 'Modifiers', groups: ['modifiers'], note: '' },
  { id: 'navigation', title: 'navigation', short: 'Navigation', groups: ['navigation'], note: '' },
  { id: 'function', title: 'function · keypad', short: 'Function', groups: ['function', 'keypad'], note: '' },
  { id: 'media', title: 'media', short: 'Media', groups: ['media'], note: '' },
  { id: 'layers', title: 'layers', short: 'Layers', groups: [], note: 'mo · to · tog · sl' },
  { id: 'dual', title: 'dual-function', short: 'Dual', groups: [], note: 'lt · mt · gresc' },
  { id: 'system', title: 'system', short: 'System', groups: [], note: 'reset · bt · out · caps' },
  { id: 'mouse', title: 'mouse', short: 'Mouse', groups: [], note: 'mkp · mmv · msc' },
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

/** The dock's row of category buttons: letters/symbols/modifiers/navigation up
 * front, the rest (function, media and the behaviour kinds) folded behind the
 * "More" dropup. */
const MORE_IDS = ['function', 'media', 'layers', 'dual', 'system', 'mouse']

const primaryKinds = computed(() => KINDS.filter((k) => !MORE_IDS.includes(k.id)))
const moreKinds = computed(() => KINDS.filter((k) => MORE_IDS.includes(k.id)))

/* ---------------------------------------------------------------- tabs */

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


/* ---------------------------------------------------------------- step machine */

/* kind      → category chosen (panel is open)
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

/* ---------------------------------------------------------------- dock state */

const open = ref(false)
const showMore = ref(false)
const groupTab = ref<'*' | string>('*')
const menuOpen = ref(false)

/** The panel is up when a category is chosen or a search is live. */
const isOpen = computed(() => open.value && (kindId.value !== null || q.value.length > 0))
const paramMode = computed(() => flow.value === 'param')
const searching = computed(() => q.value.length > 0)

/* Writing state, driven from the same stores the rest of the page uses. */
const canApply = computed(() => !props.busy && keymap.isDirty)
const canRevert = computed(() => !props.busy && keymap.isDirty)
const canWriteNext = computed(() => !props.busy && device.writable)

/** The "More" button lights when its menu is open or a folded category is active. */
const moreHasActive = computed(() => showMore.value || moreKinds.value.some((k) => k.id === kindId.value))

const moreWrapTitle = computed(() => `more: ${moreKinds.value.map((k) => k.short).join(', ')}`)

/** The category's sub-groups as tabs along the panel's top edge. */
const shownSections = computed(() =>
  groupTab.value === '*' ? sections.value : sections.value.filter((s) => s.title === groupTab.value),
)

/** Cross-category search: replaces the category view with every matching key. */
const searchResults = computed(() => {
  const qv = q.value
  if (!qv) return []
  const wrapTok = wrapToken.value
  if (!wrapTok) return []
  const out: Array<{ main: string; sub: string; binding: Binding }> = []
  for (const k of KINDS) {
    for (const gid of k.groups) {
      const items = (CATALOG as Record<string, Array<{ name: string; label: string; code: number }>>)[gid]
      for (const item of items ?? []) {
        if (item.name.toUpperCase().includes(qv) || item.label.toUpperCase().includes(qv)) {
          out.push({ main: item.label, sub: item.name, binding: { token: wrapTok.id, param1: item.code, param2: 0 } })
        }
      }
    }
  }
  return out.slice(0, 60)
})

function toggleKind(id: string): void {
  query.value = ''
  cancelStep()
  showMore.value = false
  if (kindId.value === id) {
    collapse()
    return
  }
  pickKind(id)
  groupTab.value = '*'
  open.value = true
}

function collapse(): void {
  kindId.value = null
  cancelStep()
  groupTab.value = '*'
  showMore.value = false
  menuOpen.value = false
  open.value = false
}

function pickKind(id: string): void {
  kindId.value = id
  cancelStep()
  groupTab.value = '*'
}

/** After a binding is fully filled in, collapse back to the dock bar. */
function reset(): void {
  collapse()
}

function stage(c: Binding): void {
  if (!canWrite.value) return
  emit('set', c)
}

/* ---------------------------------------------------------------- dock actions */

function runAction(kind: 'apply' | 'revert' | 'save' | 'discard'): void {
  menuOpen.value = false
  showMore.value = false
  ;(emit as (e: string) => void)(kind)
}

/* ---------------------------------------------------------------- dock open/close */

/** A click anywhere inside the dock bar falls here: outside the two menus
 * (write actions and the More dropup) it is just a tap on the bar, so both
 * menus fold shut. The menus' own items handle their clicks themselves. */
function onBarClick(e: MouseEvent): void {
  const t = e.target as Element | null
  if (t && (t.closest('.d-actions') || t.closest('.more-wrap'))) return
  menuOpen.value = false
  showMore.value = false
}

function onDocClick(e: MouseEvent): void {
  const t = e.target as Element | null
  /* clicks outside the dock also fold the menus, even if the panel is already
   * collapsed */
  if (t && !t.closest('.dock')) {
    if (menuOpen.value) menuOpen.value = false
    if (showMore.value) showMore.value = false
  }
  if (!open.value) return
  if (!t) return
  if (t.closest('.dock')) return
  if (t.closest('.cap')) return
  collapse()
}

function onEsc(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !open.value) return
  if (pickedToken.value !== null) {
    cancelStep()
    return
  }
  collapse()
}

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onEsc)
  }
})

onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onEsc)
  }
})

/* ---------------------------------------------------------------- drag source */

/** Shared clipboard for drag-and-drop: tiles write here, caps/App read it.
 * Backed by the window so the drag source (dock) and the drop target (keycap)
 * can be far apart; accessed lazily so SSR (no window) stays happy. */
const dragWin = {
  get __keebDragBinding(): Binding | undefined {
    return typeof window !== 'undefined' ? (window as unknown as { __keebDragBinding?: Binding }).__keebDragBinding : undefined
  },
  set __keebDragBinding(b: Binding | undefined) {
    if (typeof window !== 'undefined') {
      ;(window as unknown as { __keebDragBinding?: Binding }).__keebDragBinding = b
    }
  },
}

function onTileDragStart(e: DragEvent, binding: Binding): void {
  dragWin.__keebDragBinding = binding
  if (e.dataTransfer) {
    e.dataTransfer.setData('text/plain', 'keeb-binding')
    e.dataTransfer.effectAllowed = 'move'
  }
}

function onTileDragEnd(): void {
  dragWin.__keebDragBinding = undefined
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
  <section class="dock" :class="{ open: isOpen }" aria-label="Key dock">
    <!-- The panel, which rises from the bottom when a category is chosen or a
         search is live. @click.stop keeps a panel-internal click from being
         read as a click on empty space. -->
    <div v-if="isOpen" class="panel" @click.stop>
      <p v-if="reserved" class="note bad">
        position {{ pos }} is reserved — the firmware will not rebind it
      </p>

      <!-- STEP: fill a parameter for a chosen token (layers, dual, system, mouse). -->
      <template v-if="paramMode">
        <div class="param-head">
          <button class="chip back" title="back to the token" @click="cancelStep">‹&nbsp;{{ TOKENS.find((t) => t.id === pickedToken)?.label ?? '?' }}</button>
          <span class="note">{{ currentParamLabel }} · param {{ paramStep + 1 }}</span>
          <button class="chip small" title="throw this step away" @click="cancelStep">Cancel</button>
        </div>

        <div class="tiles">
          <!-- layer -->
          <template v-if="currentParamKind === 'layer'">
            <button
              v-for="l in layerSlots"
              :key="l.id"
              class="tile layer"
              :class="{ live: l.live }"
              :disabled="!canWrite"
              @click="setParam(l.id)"
            >
              {{ l.name }}
              <small>{{ l.live ? 'live' : 'slot' }}</small>
            </button>
          </template>

          <!-- keycode -->
          <template v-else-if="currentParamKind === 'keycode'">
            <button
              v-for="k in keycodeHits"
              :key="k.name"
              class="tile"
              @click="setParam(k.code)"
            >
              {{ k.label }}
              <small>{{ k.name }}</small>
            </button>
          </template>

          <!-- mouse vector -->
          <template v-else-if="currentParamKind === 'mouse-vector'">
            <button
              v-for="n in (TOKENS.find((t) => t.id === pickedToken)?.label === 'msc' ? SCRL_ITEMS : MOVE_ITEMS)"
              :key="n"
              class="tile"
              @click="setParam(KEYCODES[n] ?? 0)"
            >
              {{ n.replace(/^MOVE_/, '').replace(/^SCRL_/, '') }}
              <small>{{ n }}</small>
            </button>
          </template>

          <!-- button mask -->
          <template v-else-if="currentParamKind === 'button-mask'">
            <button
              v-for="(n, i) in BUTTON_ITEMS"
              :key="n"
              class="tile"
              :class="{ on: ((paramValues[0] ?? 0) & (1 << i)) !== 0 }"
              @click="setParam((paramValues[0] ?? 0) ^ (1 << i))"
            >
              {{ n }}
              <small>button</small>
            </button>
          </template>

          <!-- bt command -->
          <template v-else-if="currentParamKind === 'bt-cmd'">
            <button
              v-for="b in BT_ITEMS"
              :key="b.v"
              class="tile"
              @click="setParam(b.v)"
            >
              {{ b.label }}
              <small>BT {{ b.v }}</small>
            </button>
          </template>

          <!-- output -->
          <template v-else-if="currentParamKind === 'output'">
            <button
              v-for="o in OUT_ITEMS"
              :key="o.v"
              class="tile"
              @click="setParam(o.v)"
            >
              {{ o.label }}
              <small>output</small>
            </button>
          </template>

          <!-- plain number -->
          <template v-else>
            <input
              class="num"
              type="number"
              :value="paramValues[paramStep] ?? 0"
              placeholder="value…"
              @change="setParam(Number(($event.target as HTMLInputElement).value))"
            />
          </template>
        </div>
      </template>

      <!-- SEARCH: results across every category. -->
      <template v-else-if="searching">
        <div class="ptabs">
          <span class="ptab-note">matches across all categories</span>
          <span class="count">{{ searchResults.length }}</span>
        </div>
        <div class="tiles">
          <button
            v-for="(r, i) in searchResults"
            :key="`${r.sub}-${i}`"
            class="tile"
            :disabled="!canWrite"
            draggable="true"
            @dragstart="onTileDragStart($event, r.binding)"
            @dragend="onTileDragEnd"
            @click="stage(r.binding)"
          >
            {{ r.main }}
            <small>{{ r.sub }}</small>
          </button>
        </div>
        <p v-if="!searchResults.length" class="note">nothing matches “{{ query }}”</p>
      </template>

      <!-- CATEGORY: either keycodes (with sub-group tabs) or a token flow. -->
      <template v-else>
        <!-- sub-group tabs on the panel's top edge -->
        <div v-if="sections.length > 1" class="ptabs">
          <button class="ptab" :class="{ on: groupTab === '*' }" @click="groupTab = '*'">All</button>
          <button
            v-for="s in sections"
            :key="s.title"
            class="ptab"
            :class="{ on: groupTab === s.title }"
            @click="groupTab = s.title"
          >
            {{ s.title }}
          </button>
        </div>

        <!-- normal keycodes: the wrap variant stays as a quiet chip row. -->
        <div v-if="flow === 'choices'" class="wraprow">
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

        <!-- keycode tiles for the active sub-group -->
        <div v-if="flow === 'choices'" class="tiles">
          <button
            v-for="c in shownSections.flatMap((s) => s.items)"
            :key="c.id"
            class="tile"
            :disabled="!canWrite"
            draggable="true"
            :title="`assign ${c.main}${c.sub !== c.main ? ` (${c.sub})` : ''} to position ${pos}`"
            @dragstart="onTileDragStart($event, c.binding)"
            @dragend="onTileDragEnd"
            @click="stage(c.binding)"
          >
            {{ c.main }}
            <small>{{ c.sub }}</small>
          </button>
        </div>

        <!-- token flow: layers / dual / system / mouse -->
        <div v-if="flow === 'token'" class="tiles">
          <template v-if="kind?.id === 'layers'">
            <button
              v-for="op in layerOps"
              :key="op.label"
              class="tile"
              :disabled="!canWrite"
              @click="startToken(op.label)"
            >
              &amp;{{ op.label }}
              <small>{{ op.name }}</small>
            </button>
          </template>
          <template v-if="kind?.id === 'dual'">
            <button
              v-for="op in dualOps"
              :key="op.label"
              class="tile"
              :disabled="!canWrite"
              @click="startToken(op.label)"
            >
              &amp;{{ op.label }}
              <small>{{ op.name }}</small>
            </button>
          </template>
          <template v-if="kind?.id === 'system'">
            <button
              v-for="op in systemItems.filter((x) => !x.hasParams)"
              :key="op.label"
              class="tile"
              :disabled="!canWrite"
              @click="stage({ token: op.token, param1: 0, param2: 0 })"
            >
              &amp;{{ op.label }}
              <small>{{ op.name }}</small>
            </button>
            <button
              v-for="op in systemItems.filter((x) => x.hasParams)"
              :key="op.label"
              class="tile needs-param"
              :disabled="!canWrite"
              @click="startToken(op.label)"
            >
              &amp;{{ op.label }}
              <small>{{ op.name }} ·param</small>
            </button>
          </template>
          <template v-if="kind?.id === 'mouse'">
            <button
              v-for="op in mouseOps"
              :key="op.label"
              class="tile"
              :disabled="!canWrite"
              @click="startToken(op.label)"
            >
              &amp;{{ op.label }}
              <small>{{ op.name }}</small>
            </button>
          </template>
        </div>

        <p v-if="flow === 'choices' && !sections.length" class="note">nothing in this category</p>
      </template>
    </div>

    <!-- The collapsed dock: search + category buttons + write actions. -->
    <div class="bar" @click.stop="onBarClick">
      <label class="grow">
        <input
          v-model="query"
          class="search"
          type="search"
          placeholder="search keys…"
          aria-label="search keys across all categories"
          @focus="open = true"
        />
      </label>

      <div class="cats">
        <button
          v-for="k in primaryKinds"
          :key="k.id"
          class="cat"
          :class="{ on: kindId === k.id }"
          :title="k.note"
          @click="toggleKind(k.id)"
        >
          {{ k.short }}
        </button>

        <!-- The folded categories (function, media, layers, dual, system, mouse)
             live behind a dropup menu that rises above the dock bar. -->
        <div class="more-wrap">
          <button
            class="cat more"
            :class="{ on: moreHasActive }"
            :aria-expanded="showMore"
            :title="moreWrapTitle"
            @click="showMore = !showMore"
          >
            More
            <small :class="{ up: showMore }">▴</small>
          </button>

          <div v-if="showMore" class="more-menu">
            <button
              v-for="k in moreKinds"
              :key="k.id"
              class="more-item"
              :class="{ on: kindId === k.id }"
              :title="k.note"
              @click="toggleKind(k.id)"
            >
              {{ k.short }}
              <small>{{ k.note }}</small>
            </button>
          </div>
        </div>
      </div>

      <!-- Write actions: Apply is the loud one, the rest fold under it. -->
      <div class="d-actions">
        <button
          class="go-apply"
          :disabled="!canApply"
          title="send one CELLS_SET per dirty layer"
          @click.stop="runAction('apply')"
        >
          Apply{{ keymap.dirtyTotal ? ` (${keymap.dirtyTotal})` : '' }}
        </button>

        <div class="d-menu">
          <button
            class="go-more"
            :class="{ on: menuOpen }"
            :aria-expanded="menuOpen"
            :aria-label="menuOpen ? 'close more actions' : 'more actions: revert, save, discard'"
            title="revert · save · discard"
            @click.stop="menuOpen = !menuOpen"
          >
            ⋯
          </button>

          <div v-if="menuOpen" class="d-drop" @click.stop>
            <button :disabled="!canRevert" title="throw the staged edits away; the keyboard was never asked to change" @click="runAction('revert')">Revert{{ keymap.dirtyTotal ? ` (${keymap.dirtyTotal})` : '' }}</button>
            <button :disabled="!canWriteNext" title="tell the keyboard to persist the layout it has now" @click="runAction('save')">Save to keyboard</button>
            <button :disabled="!canWriteNext" title="reload the layout from the keyboard's saved settings" @click="runAction('discard')">Discard</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* The dock: a floating tray pinned to the bottom. Collapsed it is one pill
 * (the bar); open it grows a translucent panel upward, roughly a third of the
 * viewport tall, so the board above stays visible while you assign keys. */
.dock {
  position: fixed;
  left: 50%;
  bottom: 86px;
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: min(920px, calc(100vw - 32px));
  pointer-events: none;
}

.dock * {
  pointer-events: auto;
}

/* The risen panel: a glass tray that opens upward from the dock. */
.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 34vh;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px;
  margin-bottom: 10px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: rgba(14, 11, 9, 0.82);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5);
}

/* The dock bar itself: a warm pill the width of its content, centred, so there
 * is no empty run trailing past Apply. (The risen panel, by contrast, still
 * stretches to the dock's width.) */
.bar {
  align-self: center;
  width: fit-content;
  max-width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
}

/* A compact inline filter, not a full-width field. */
.grow {
  flex: none;
  width: 168px;
  min-width: 0;
}

.search {
  width: 100%;
  padding: 8px 14px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: rgba(0, 0, 0, 0.4);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
}

.search::placeholder { color: var(--mid); }
.search:focus { border-color: var(--accent); outline: none; }

.cats {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.cat {
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid transparent;
  color: var(--mid);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}

.cat:hover:not(.more) { color: var(--ink); }

.cat.on {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(110, 231, 160, 0.6);
  color: var(--ink);
  font-weight: 600;
}

.cat.more { color: var(--mid); display: inline-flex; align-items: center; gap: 3px; }
.cat.more.on { color: var(--ink); }
.cat.more small { font-size: 9px; display: inline-block; transition: transform 0.12s ease; }
.cat.more small.up { transform: rotate(180deg); }

/* The folded categories open as a dropup that rises above the dock bar. */
.more-wrap { position: relative; }

.more-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 200px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(14, 11, 9, 0.92);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 -18px 40px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}

.more-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border-radius: 9px;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.more-item small { font-size: 10px; color: var(--mid); white-space: nowrap; }
.more-item:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
.more-item.on { background: rgba(110, 231, 160, 0.18); color: #6ee7a0; }
.more-item.on small { color: inherit; opacity: 0.8; }

/* Write actions on the dock: Apply is the loud primary, the secondary menu
 * (revert / save / discard) is a small disclosure next to it. */
.d-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 4px;
}

.go-apply {
  padding: 10px 20px;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, #9deab8, var(--accent-deep));
  color: var(--on-accent);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: 0 0 24px var(--accent-dim);
  transition: filter 0.12s ease;
}

.go-apply:hover:not(:disabled) { filter: brightness(1.06); }
.go-apply:disabled { opacity: 0.5; cursor: default; box-shadow: none; }

.d-menu {
  position: relative;
}

.go-more {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--mid);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.go-more:hover { color: var(--ink); border-color: var(--ink); }
.go-more.on { background: rgba(255, 255, 255, 0.12); color: var(--ink); border-color: rgba(110, 231, 160, 0.6); }

.d-drop {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  min-width: 180px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(14, 11, 9, 0.92);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}

.d-drop button {
  padding: 9px 12px;
  border-radius: 9px;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.d-drop button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); color: var(--accent); }
.d-drop button:disabled { opacity: 0.45; cursor: not-allowed; }

/* Panel head: sub-group tabs along the top edge. */
.ptabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin: -2px;
}

.ptab {
  padding: 5px 14px;
  border-radius: 999px;
  border: 1px solid transparent;
  color: var(--mid);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.ptab:hover { color: var(--ink); }
.ptab.on {
  background: #1e2733;
  border-color: rgba(110, 231, 160, 0.6);
  color: var(--ink);
  font-weight: 600;
}

.ptab-note {
  font-size: 12px;
  color: var(--mid);
  margin-right: 4px;
}

.count { font-size: 11px; color: var(--mid); }

.wraprow {
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

.chip {
  border: 1px solid var(--line);
  background: transparent;
  border-radius: 999px;
  color: var(--mid);
  font: inherit;
  font-size: 12px;
  padding: 4px 12px;
  cursor: pointer;
}

.chip:hover:not(:disabled) { color: var(--ink); border-color: var(--ink); }
.chip.on { background: #1e2733; color: var(--ink); border-color: rgba(110, 231, 160, 0.6); font-weight: 700; }
.chip.small { font-size: 11px; }
.chip.back { font-weight: 600; color: var(--ink); }

/* The key grid: keycap-shaped tiles, warm and lightly inviting. */
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(54px, 1fr));
  gap: 6px;
}

.tile {
  min-height: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 6px 4px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: linear-gradient(160deg, #2c333c, #171b21);
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: border-color 0.12s ease, transform 0.12s ease, box-shadow 0.12s ease;
}

.tile small {
  font-size: 9px;
  color: var(--mid);
  text-align: center;
  word-break: break-word;
}

.tile:hover:not(:disabled) {
  border-color: rgba(110, 231, 160, 0.6);
  transform: translateY(-1px);
  box-shadow: 0 0 16px rgba(46, 184, 114, 0.3), 0 4px 8px rgba(0, 0, 0, 0.4);
}

.tile:active:not(:disabled) { transform: translateY(1px); }
.tile:disabled { opacity: 0.45; cursor: not-allowed; }

.tile.layer { font-weight: 600; }
.tile.layer.live { border-color: var(--ok); }
.tile.needs-param small { color: var(--accent); }
.tile.on { background: linear-gradient(160deg, #9deab8, #2eb872); color: #07170e; border-color: transparent; box-shadow: 0 0 20px rgba(46, 184, 114, 0.5); }
.tile.on small { color: #07170e; opacity: 0.75; }

.param-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.num {
  width: 140px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.4);
  color: var(--ink);
  font: inherit;
}

.note { margin: 0; font-size: 12px; color: var(--mid); }
.note.bad { color: var(--err); }

@media (max-width: 700px) {
  .dock { bottom: 76px; }
  .bar { width: 100%; gap: 6px; padding: 8px; }
  .grow { flex: 1 1 100%; }
  .cat { padding: 6px 11px; font-size: 12px; }
}
</style>