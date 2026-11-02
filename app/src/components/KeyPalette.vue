<!--
  The keycode palette.

  It sits under the keyboard, in the wide part of the page, because choosing what
  a key becomes is a browsing task: a category, a group, a key. Three clicks, no
  typing, no text field to get wrong.

  That matters most when the keyboard is the thing that is broken. A dead layer
  key or a stuck modifier is fixed by clicking the cap on the grid and then
  clicking a real chip here — and a menu you can only reach by typing is useless
  to a keyboard that cannot type.

  Mouse bindings are a chip that opens the picker instead of a group of chips:
  `&mkp / &mmv / &msc` take vectors and masks, not a keycode, and pretending
  otherwise would stage a binding the firmware rejects.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'

import { CATALOG } from '../data/keycodes.ts'
import { TOKENS } from '../proto/zmk.gen.ts'
import type { Binding } from '../proto/types.ts'
import { useDeviceStore } from '../stores/device.ts'
import { LAYER_ID_INVALID, NONE_TOKEN, TRANSPARENT_TOKEN, useKeymapStore } from '../stores/keymap.ts'

const props = defineProps<{ pos: number | null; reserved: boolean }>()

const emit = defineEmits<{
  (e: 'set', binding: Binding): void
}>()

const device = useDeviceStore()
const keymap = useKeymapStore()

const KINDS: Array<{ id: string; title: string; groups: string[] }> = [
  { id: 'letters', title: 'letters · numbers', groups: ['letters', 'numbers'] },
  { id: 'symbols', title: 'symbols', groups: ['symbols', 'shifted'] },
  { id: 'modifiers', title: 'modifiers', groups: ['modifiers'] },
  { id: 'navigation', title: 'navigation', groups: ['navigation'] },
  { id: 'function', title: 'function · keypad', groups: ['function', 'keypad'] },
  { id: 'media', title: 'media', groups: ['media'] },
  { id: 'behaviors', title: 'behaviors', groups: [] },
  { id: 'system', title: 'bluetooth · output', groups: ['bluetooth', 'outputs'] },
  { id: 'mouse', title: 'mouse', groups: ['mouseButtons', 'mouseMove', 'mouseScroll'] },
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
  bluetooth: 'bluetooth',
  outputs: 'output',
  behaviors: 'no arguments',
  mouseButtons: 'buttons',
  mouseMove: 'move',
  mouseScroll: 'scroll',
}

/* The catalog carries mouse groups for the mouse editors' benefit. */
const KEYCODE_GROUPS = Object.keys(CATALOG)

const kindId = ref<string | null>(null)
const wrap = ref<'kp' | 'kt' | 'sk'>('kp')
const query = ref('')

const WRAP_NOTE: Record<typeof wrap.value, string> = {
  kp: 'tap',
  kt: 'sticky-off toggle',
  sk: 'sticky key',
}

const wrapToken = computed(() => TOKENS.find((t) => t.label === wrap.value))

const readyIds = computed(() => new Set(device.readyTokens.map((t) => t.token)))
const hasDeviceTokens = computed(() => device.tokens.length > 0)

const usable = (token: number): boolean => !hasDeviceTokens.value || readyIds.value.has(token)

const canWrite = computed(
  () => props.pos !== null && !props.reserved && keymap.editingId !== LAYER_ID_INVALID,
)

const kind = computed(() => KINDS.find((k) => k.id === kindId.value) ?? null)

const behaviors = computed(() =>
  TOKENS.filter(
    (t) => t.bindingCells === 0 && t.id !== TRANSPARENT_TOKEN && t.id !== NONE_TOKEN && usable(t.id),
  ).map((t) => ({
    id: `behavior:${t.label}`,
    main: `&${t.label}`,
    sub: t.displayName ?? t.name,
    binding: { token: t.id, param1: 0, param2: 0 } as Binding,
  })),
)

/* The groups on show: the chosen category's, or the whole catalog when the
 * person typed instead of browsing. Every group in them is drawn with its keys,
 * because a panel that stays empty until something is typed is a panel that
 * blames the person for what it did not draw. */
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

/* One shape for everything the list can hold: a chip, a line of detail, and the
 * binding it stages. Keycodes and behaviors differ in where they come from, not
 * in what choosing one does. */
const sections = computed(() => {
  if (kind.value?.id === 'behaviors') {
    return [
      {
        title: 'no arguments',
        items: behaviors.value.filter(
          (b) => !q.value.length || b.main.includes(q.value) || b.sub.toUpperCase().includes(q.value),
        ),
      },
    ]
  }

  const token = wrapToken.value

  if (!token) {
    return []
  }

  return groupsFor.value
    .map((g) => ({
      title: g.title,
      items: g.items
        .filter(matches)
        .map((item) => ({
          id: `${g.id}:${item.name}`,
          main: item.label,
          sub: item.name,
          binding: { token: token.id, param1: item.code, param2: 0 } as Binding,
        })),
    }))
    .filter((s) => s.items.length > 0)
})

const total = computed(() => sections.value.reduce((n, s) => n + s.items.length, 0))

/* Typing is a complete way in: it selects the list without a category. Clicking
 * a category is the other way in, and it needs no typing at all. */
const step = computed(() => (kind.value || q.value.length ? 'choices' : 'kind'))

const crumbs = computed(() => {
  const out: Array<{ id: string | null; label: string }> = [{ id: null, label: 'category' }]

  if (kind.value) {
    out.push({ id: 'kind', label: kind.value.title })
  }

  return out
})

function pickKind(id: string): void {
  kindId.value = id
}

function crumb(id: string | null): void {
  if (id === null) {
    reset()
    return
  }

  kindId.value = null
}

function back(): void {
  if (q.value.length) {
    query.value = ''
    return
  }

  kindId.value = null
}

function reset(): void {
  kindId.value = null
  query.value = ''
}

function stage(c: { binding: Binding }): void {
  if (!canWrite.value) {
    return
  }

  emit('set', c.binding)
}
</script>

<template>
  <section class="palette">
    <header class="phead">
      <h2>keycodes</h2>

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

      <span v-if="step === 'choices'" class="count" aria-live="polite">{{ total }} shown</span>

      <span class="target">
        <template v-if="pos === null">no key selected</template>
        <template v-else>→ position {{ pos }} · {{ keymap.editingName }}</template>
      </span>

      <button class="chip back" :disabled="step === 'kind' && !query" title="one step back" @click="back">back</button>
    </header>

    <p v-if="reserved" class="note bad">position {{ pos }} is reserved: the firmware will not rebind it</p>

    <!-- Step 1: what kind of key. -->
    <div v-if="step === 'kind'" class="grid">
      <button
        v-for="k in KINDS"
        :key="k.id"
        class="big"
        :disabled="pos === null || reserved"
        :title="k.groups.length ? `${k.groups.length} group(s) inside` : k.id === 'mouse' ? 'these take arguments — opens the picker' : 'no arguments to fill in'"
        @click="pickKind(k.id)"
      >
        {{ k.title }}
        <small>{{ k.groups.length ? `${k.groups.length} groups` : k.id === 'mouse' ? 'picker…' : `${behaviors.length}` }}</small>
      </button>
    </div>

    <!-- The keys, grouped, all of them, narrowed by whatever has been typed.
         There is no state where this panel is empty and waiting: the list is
         drawn from the moment a category is chosen or a letter is typed. -->
    <div v-else class="choices">
      <div v-if="kind?.id !== 'behaviors'" class="variants">
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
        <h3>
          {{ s.title }}
          <small>{{ s.items.length }}</small>
        </h3>

        <div class="keys">
          <button
            v-for="c in s.items"
            :key="c.id"
            class="key"
            :disabled="!canWrite"
            :title="`stage ${c.main} at position ${pos}`"
            @click="stage(c)"
          >
            {{ c.main }}
            <small>{{ c.sub }}</small>
          </button>
        </div>
      </section>

      <p v-if="!sections.length" class="note">nothing in the catalog matches “{{ query }}”</p>
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
/* The current category is part of the path, not a heading: it reads like the
 * "layer" label above the board — same size, same colour, no weight change. */
.crumb.here { color: var(--mid); font-weight: 400; }

.target {
  margin-left: auto;
  font-size: 12px;
  color: var(--mid);
}

/* The search is always here: it is the shortcut, and it never has to be opened
 * before the list is worth looking at. */
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
  /* The list is long on purpose — the whole group is there, not a page of it —
   * so it takes whatever height is left under the board and scrolls inside
   * itself rather than pushing the board off screen. */
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

/* Wide on purpose: 26 letters on one line is a keyboard you can read, and a
 * chip you can hit with a mouse. */
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
</style>
