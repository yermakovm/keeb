<script setup lang="ts">
/*
 * Selected widget inspector — lives in the aside when a panel is being edited.
 *
 * The form edits a single widget by index via the display store. It is separated
 * from the canvas so the spatial view stays clean and the properties panel is
 * always in the same place.
 */
import { computed, ref } from 'vue'

import {
  ALIGN_LABELS,
  FONT_LABELS,
  KIND_LABELS,
  KIND_ORDER,
  KIND_STYLE_HELP,
  PIPS_LABELS,
  SOURCE_LABELS,
  slotIndexOf,
  sourcesForKind,
} from '../data/widgets.ts'
import {
  KEEB_SRC_TEXT_BASE,
  KEEB_SRC_VALUE_BASE,
  KEEB_WID_NONE,
  KEEB_WID_FRAME,
  KEEB_WID_RECT,
  KEEB_WID_TEXT,
  KEEB_WID_PIPS,
  KEEB_WID_ART,
  KEEB_TEXT_STYLE,
  KEEB_STYLE_FONT,
  KEEB_STYLE_ALIGN,
} from '../proto/constants.ts'
import { useDisplayStore } from '../stores/display.ts'
import type { Widget } from '../proto/types.ts'

const panel = useDisplayStore()
const busy = ref(false)
const message = ref('')

const sel = computed<Widget | null>(() => panel.widgets[panel.selectedWidget] ?? null)
const selReason = computed(() => (sel.value ? panel.validate(sel.value) : ''))

const sources = computed(() =>
  sel.value ? sourcesForKind(sel.value.kind, KEEB_SRC_TEXT_BASE, KEEB_SRC_VALUE_BASE) : [],
)

const hasStyle = computed(() => {
  const kind = sel.value?.kind ?? KEEB_WID_NONE
  return kind === KEEB_WID_FRAME || kind === KEEB_WID_RECT || kind === KEEB_WID_TEXT || kind === KEEB_WID_PIPS || kind === KEEB_WID_ART
})

const fontOf = (w: Widget): number => KEEB_STYLE_FONT(w.style)
const alignOf = (w: Widget): number => KEEB_STYLE_ALIGN(w.style)

function patch(key: 'x' | 'y' | 'w' | 'h', value: number): void {
  const why = panel.edit(panel.selectedWidget, { [key]: value })
  if (why) message.value = why
}

function patchKind(kind: number): void {
  const sourcesFor = sourcesForKind(kind, KEEB_SRC_TEXT_BASE, KEEB_SRC_VALUE_BASE)
  const why = panel.edit(panel.selectedWidget, { kind, source: sourcesFor[0] })
  if (why) message.value = why
}

function patchSource(source: number): void {
  const why = panel.edit(panel.selectedWidget, { source })
  if (why) message.value = why
}

function patchStyle(value: number): void {
  if (!sel.value) return
  const why = panel.edit(panel.selectedWidget, { style: value })
  if (why) message.value = why
}

function patchTextFont(value: number): void {
  if (!sel.value) return
  patchStyle(KEEB_TEXT_STYLE(value, alignOf(sel.value)))
}

function patchTextAlign(value: number): void {
  if (!sel.value) return
  patchStyle(KEEB_TEXT_STYLE(fontOf(sel.value), value))
}

async function run(label: string, fn: () => Promise<{ ok: boolean; reason?: string }>): Promise<void> {
  busy.value = true
  message.value = ''
  const r = await fn()
  message.value = r.ok ? `${label} sent to the keyboard` : (r.reason ?? `${label} failed`)
  busy.value = false
}

async function writeText(slot: number, value: string): Promise<void> {
  await run(`text ${slot}`, () => panel.setTextSlot(slot, value))
}

async function writeValue(slot: number, value: number): Promise<void> {
  await run(`value ${slot}`, () => panel.setValueSlot(slot, value))
}

function sourceLabel(source: number): string {
  if (source >= KEEB_SRC_TEXT_BASE) {
    return `text ${slotIndexOf(source, KEEB_SRC_TEXT_BASE)}`
  }
  if (source >= KEEB_SRC_VALUE_BASE) {
    return `value ${source - KEEB_SRC_VALUE_BASE}`
  }
  return SOURCE_LABELS[source] ?? `source ${source}`
}
</script>

<template>
  <div class="inspector">
    <div v-if="message" class="msg">{{ message }}</div>
    <div v-if="panel.lastError" class="msg err">{{ panel.lastError }}</div>

    <div v-if="sel" class="sel">
      <div class="sel-row">
        <label>kind
          <select :value="sel.kind" :disabled="!panel.canEdit" @change="patchKind(Number(($event.target as HTMLSelectElement).value))">
            <option v-for="k in KIND_ORDER" :key="k" :value="k">{{ KIND_LABELS[k] }}</option>
          </select>
        </label>

        <label>source
          <select :value="sel.source" :disabled="!panel.canEdit" @change="patchSource(Number(($event.target as HTMLSelectElement).value))">
            <option v-for="s in sources" :key="s" :value="s">{{ sourceLabel(s) }}</option>
          </select>
        </label>
      </div>

      <div class="sel-row geo">
        <label>x<input type="number" min="0" :max="panel.logicalW - 1" :value="sel.x" :disabled="!panel.canEdit" @change="patch('x', Number(($event.target as HTMLInputElement).value))" /></label>
        <label>y<input type="number" min="0" :max="panel.logicalH - 1" :value="sel.y" :disabled="!panel.canEdit" @change="patch('y', Number(($event.target as HTMLInputElement).value))" /></label>
        <label>w<input type="number" min="0" :max="panel.logicalW" :value="sel.w" :disabled="!panel.canEdit" @change="patch('w', Number(($event.target as HTMLInputElement).value))" /></label>
        <label>h<input type="number" min="0" :max="panel.logicalH" :value="sel.h" :disabled="!panel.canEdit" @change="patch('h', Number(($event.target as HTMLInputElement).value))" /></label>
      </div>

      <div v-if="hasStyle" class="sel-row">
        <label v-if="sel.kind === KEEB_WID_FRAME">radius
          <input type="number" min="0" max="8" :value="sel.style" :disabled="!panel.canEdit" @change="patchStyle(Number(($event.target as HTMLInputElement).value))" />
        </label>

        <label v-else-if="sel.kind === KEEB_WID_RECT">fill
          <select :value="sel.style" :disabled="!panel.canEdit" @change="patchStyle(Number(($event.target as HTMLSelectElement).value))">
            <option :value="0">ink</option>
            <option :value="1">paper</option>
          </select>
        </label>

        <template v-else-if="sel.kind === KEEB_WID_TEXT">
          <label>font
            <select :value="fontOf(sel)" :disabled="!panel.canEdit" @change="patchTextFont(Number(($event.target as HTMLSelectElement).value))">
              <option v-for="(f, i) in FONT_LABELS" :key="f" :value="i">{{ f }}</option>
            </select>
          </label>
          <label>align
            <select :value="alignOf(sel)" :disabled="!panel.canEdit" @change="patchTextAlign(Number(($event.target as HTMLSelectElement).value))">
              <option v-for="(a, i) in ALIGN_LABELS" :key="a" :value="i">{{ a }}</option>
            </select>
          </label>
        </template>

        <label v-else-if="sel.kind === KEEB_WID_PIPS">pip size
          <select :value="sel.style" :disabled="!panel.canEdit" @change="patchStyle(Number(($event.target as HTMLSelectElement).value))">
            <option v-for="(p, i) in PIPS_LABELS" :key="p" :value="i">{{ p }}</option>
          </select>
        </label>

        <label v-else-if="sel.kind === KEEB_WID_ART">anchor
          <select :value="sel.style" :disabled="!panel.canEdit" @change="patchStyle(Number(($event.target as HTMLSelectElement).value))">
            <option :value="0">centre</option>
            <option :value="1">bottom</option>
          </select>
        </label>

        <span class="style-help">{{ KIND_STYLE_HELP[sel.kind] }}</span>
      </div>

      <div class="sel-row">
        <button class="btn link" :disabled="!panel.canEdit" @click="panel.moveWidget(panel.selectedWidget, panel.selectedWidget - 1)">move up</button>
        <button class="btn link" :disabled="!panel.canEdit" @click="panel.moveWidget(panel.selectedWidget, panel.selectedWidget + 1)">move down</button>
        <button class="btn link danger" :disabled="!panel.canEdit" @click="panel.removeWidget(panel.selectedWidget); panel.selectedWidget = Math.max(0, panel.selectedWidget - 1)">remove</button>
        <span v-if="selReason" class="bad">{{ selReason }}</span>
      </div>
    </div>

    <div class="slots">
      <h3>text slots <small>host-written, persisted by Save</small></h3>
      <div v-for="s in panel.textSlots" :key="s" class="slot">
        <span class="idx">{{ s - 1 }}</span>
        <input
          type="text"
          :maxlength="panel.textMax"
          :value="panel.texts[s - 1] ?? ''"
          :disabled="!panel.canEdit"
          @change="writeText(s - 1, ($event.target as HTMLInputElement).value)"
        />
      </div>

      <h3>value slots <small>live only — never persisted</small></h3>
      <div v-for="s in panel.valueSlots" :key="s" class="slot">
        <span class="idx">{{ s - 1 }}</span>
        <input type="number" min="-32768" max="32767" :value="panel.values[s - 1] ?? 0" :disabled="!panel.canEdit" @change="writeValue(s - 1, Number(($event.target as HTMLInputElement).value))" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.inspector { display: flex; flex-direction: column; gap: 10px; }
.msg { font-size: 12px; color: var(--text-dim); }
.msg.err { color: var(--err); }

.sel { border: 1px solid var(--border); border-radius: 0; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.sel-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
label { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--text-dim); }
select, input { font: inherit; font-size: 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 0; padding: 3px 6px; }
input[type='number'] { width: 62px; }
input[type='text'] { flex: 1; min-width: 120px; }
.style-help { font-size: 11px; color: var(--text-faint); }
.btn { border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer; font: inherit; font-size: 12px; padding: 5px 10px; }
.btn:hover:not(:disabled) { border-color: var(--ink); color: var(--ink); }
.btn:disabled { opacity: 0.62; cursor: default; }
.btn.link { border: none; background: none; padding: 0; font-size: 11px; color: var(--text-faint); text-decoration: underline; }
.btn.danger { color: var(--err); }
.bad { color: var(--err); }

.slots h3 { margin: 6px 0 2px; font-size: 12px; }
.slots h3 small { color: var(--text-faint); font-weight: 400; }
.slot { display: grid; grid-template-columns: 24px 1fr; gap: 8px; align-items: center; }
.idx { color: var(--text-faint); font-variant-numeric: tabular-nums; }
</style>
