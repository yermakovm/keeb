<script setup lang="ts">
/*
 * Panel editor: what the status screen is made of, and where it sits.
 *
 * The preview is dark ground with light ink, because that is what this build's
 * panels look like (CONFIG_ZMK_DISPLAY_INVERT): paper is the app's own
 * background and ink is the app's own text colour, so the preview matches both
 * the theme and the glass instead of imitating a beige LCD.
 *
 * The preview draws the firmware's logical space, not the glass. On this
 * keyboard the build is CONFIG_KBEEB_UI_ROTATION_90, so the logical space is
 * 68x160 and the compositor rotates it into the 160x68 panel — which is why the
 * coordinates here are the ones a widget carries, and why the picture is upright
 * while the panel is landscape.
 *
 * The sample values (layer 2 of 5, 84% / 61%, BLE, device 2) are placeholders:
 * every source is something the firmware reads from ZMK at draw time, so the
 * preview shows where a widget lands, not what it will print.
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
  describeWidget,
  slotIndexOf,
  sourcesForKind,
} from '../data/widgets.ts'
import {
  KEEB_TEXT_STYLE,
  KEEB_SRC_BATT_LEFT,
  KEEB_SRC_BATT_LEFT_PCT,
  KEEB_SRC_BATT_RIGHT,
  KEEB_SRC_BATT_RIGHT_PCT,
  KEEB_SRC_CHARGING,
  KEEB_SRC_DEVICE_ID,
  KEEB_SRC_DEVICE_NAME,
  KEEB_SRC_HOST,
  KEEB_SRC_LAYER_INDEX,
  KEEB_SRC_LAYER_NAME,
  KEEB_SRC_LAYER_POS,
  KEEB_SRC_LINK,
  KEEB_SRC_LINK_SHORT,
  KEEB_SRC_TEXT_BASE,
  KEEB_SRC_VALUE_BASE,
  KEEB_STYLE_ALIGN,
  KEEB_STYLE_FONT,
  KEEB_WID_ART,
  KEEB_WID_BAR,
  KEEB_WID_BATTERY,
  KEEB_WID_BOLT,
  KEEB_WID_FRAME,
  KEEB_WID_NONE,
  KEEB_WID_PIPS,
  KEEB_WID_RECT,
  KEEB_WID_RULE,
  KEEB_WID_TEXT,
  KBEEB_PRESET_CUSTOM,
} from '../proto/constants.ts'
import { useDeviceStore } from '../stores/device.ts'
import { useDisplayStore } from '../stores/display.ts'
import type { Widget } from '../proto/types.ts'

const device = useDeviceStore()
const panel = useDisplayStore()

const selected = ref(0)
const busy = ref(false)
const message = ref('')

const SAMPLE_LAYERS = 5
const SAMPLE_LAYER_INDEX = 2
const SAMPLE_LAYER_NAME = 'RAISE'
const SAMPLE_LEFT = 84
const SAMPLE_RIGHT = 61
const SAMPLE_DEVICE = '2'

/* The keyboard's own layer count, from DISPLAY_INFO: it is how many pips a
 * pip row draws, and what the firmware measures a row against. */
const pipCount = computed(() => panel.layerCount || SAMPLE_LAYERS)

const scale = computed(() => Math.max(1, Math.min(3, 260 / Math.max(1, panel.logicalH))))
const viewW = computed(() => panel.logicalW * scale.value)
const viewH = computed(() => panel.logicalH * scale.value)

const sel = computed<Widget | null>(() => panel.widgets[selected.value] ?? null)
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

const FONT_PX = [8, 16, 26]

function textFor(w: Widget): string {
  if (w.source >= KEEB_SRC_TEXT_BASE) {
    return panel.texts[slotIndexOf(w.source, KEEB_SRC_TEXT_BASE)] ?? ''
  }

  switch (w.source) {
    case KEEB_SRC_LAYER_INDEX:
      return String(SAMPLE_LAYER_INDEX)
    case KEEB_SRC_LAYER_NAME:
      return SAMPLE_LAYER_NAME
    case KEEB_SRC_LAYER_POS:
      return `${SAMPLE_LAYER_INDEX} / ${pipCount.value}`
    case KEEB_SRC_BATT_LEFT_PCT:
      return `${SAMPLE_LEFT}%`
    case KEEB_SRC_BATT_RIGHT_PCT:
      return `${SAMPLE_RIGHT}%`
    case KEEB_SRC_LINK:
      return 'split: connected'
    case KEEB_SRC_LINK_SHORT:
      return 'BLE'
    case KEEB_SRC_HOST:
      return 'USB'
    case KEEB_SRC_CHARGING:
      return 'charging'
    case KEEB_SRC_DEVICE_ID:
      return SAMPLE_DEVICE
    case KEEB_SRC_DEVICE_NAME:
      return 'keeb'
    default:
      return ''
  }
}

function anchorX(w: Widget): number {
  const align = w.kind === KEEB_WID_TEXT ? alignOf(w) : 0

  if (align === 1) {
    return w.x + w.w / 2
  }

  return align === 2 ? w.x + w.w : w.x
}

function textAnchor(w: Widget): string {
  const align = w.kind === KEEB_WID_TEXT ? alignOf(w) : 0

  return align === 1 ? 'middle' : align === 2 ? 'end' : 'start'
}

function textBaseline(w: Widget): number {
  const size = FONT_PX[fontOf(w)] ?? 8
  const h = w.h > 0 ? w.h : size

  return w.y + (w.h > 0 ? (h + size * 0.72) / 2 : size)
}

function barFill(w: Widget): number {
  const pct = w.source === KEEB_SRC_BATT_LEFT ? SAMPLE_LEFT : w.source === KEEB_SRC_BATT_RIGHT ? SAMPLE_RIGHT : 50

  return Math.max(0, Math.min(1, pct / 100)) * w.w
}

async function run(label: string, fn: () => Promise<{ ok: boolean; reason?: string }>): Promise<void> {
  busy.value = true
  message.value = ''

  const r = await fn()

  message.value = r.ok ? `${label} sent to the keyboard` : (r.reason ?? `${label} failed`)
  busy.value = false
}

function patch(key: 'x' | 'y' | 'w' | 'h', ev: Event): void {
  const input = ev.target as HTMLInputElement
  const why = panel.edit(selected.value, { [key]: Number(input.value) })

  if (why) {
    message.value = why
  }
}

function patchKind(ev: Event): void {
  const kind = Number((ev.target as HTMLSelectElement).value)
  const sourcesFor = sourcesForKind(kind, KEEB_SRC_TEXT_BASE, KEEB_SRC_VALUE_BASE)
  const why = panel.edit(selected.value, { kind, source: sourcesFor[0] })

  if (why) {
    message.value = why
  }
}

function patchSource(ev: Event): void {
  const why = panel.edit(selected.value, { source: Number((ev.target as HTMLSelectElement).value) })

  if (why) {
    message.value = why
  }
}

function patchStyle(value: number): void {
  if (!sel.value) {
    return
  }

  const why = panel.edit(selected.value, { style: value })

  if (why) {
    message.value = why
  }
}

function patchTextFont(ev: Event): void {
  if (!sel.value) {
    return
  }

  patchStyle(KEEB_TEXT_STYLE(Number((ev.target as HTMLSelectElement).value), alignOf(sel.value)))
}

function patchTextAlign(ev: Event): void {
  if (!sel.value) {
    return
  }

  patchStyle(KEEB_TEXT_STYLE(fontOf(sel.value), Number((ev.target as HTMLSelectElement).value)))
}

async function writeText(slot: number, ev: Event): Promise<void> {
  await run(`text ${slot}`, () => panel.setTextSlot(slot, (ev.target as HTMLInputElement).value))
}

async function writeValue(slot: number, ev: Event): Promise<void> {
  await run(`value ${slot}`, () => panel.setValueSlot(slot, Number((ev.target as HTMLInputElement).value)))
}

/** The picker already filtered sources to what this kind accepts. */
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
  <section class="panel-editor">
    <header>
      <h2>status panel</h2>
      <span class="why">{{ panel.statusLine }}</span>
      <span v-if="panel.preset !== KBEEB_PRESET_CUSTOM" class="preset">preset {{ panel.presets[panel.preset]?.name ?? panel.preset }}</span>
    </header>

    <div v-if="message" class="msg">{{ message }}</div>
    <div v-if="panel.lastError" class="msg err">{{ panel.lastError }}</div>

    <div v-if="!panel.loaded" class="empty">
      <button class="btn" :disabled="busy || !device.connected" @click="panel.load()">Read the panel from the keyboard</button>
    </div>

    <div v-else class="grid">
      <!-- The drawing, in the firmware's own coordinate space. -->
      <div class="preview">
        <svg :width="viewW" :height="viewH" :viewBox="`0 0 ${panel.logicalW} ${panel.logicalH}`" class="screen">
          <rect x="0" y="0" :width="panel.logicalW" :height="panel.logicalH" class="paper" />

          <template v-for="(w, i) in panel.widgets" :key="i">
            <g :class="['w', { sel: i === selected }]" @click="selected = i">
              <rect v-if="w.kind === KEEB_WID_FRAME" :x="w.x" :y="w.y" :width="w.w" :height="w.h" :rx="w.style" class="frame" />
              <rect v-else-if="w.kind === KEEB_WID_RECT" :x="w.x" :y="w.y" :width="w.w" :height="w.h" :class="w.style === 1 ? 'paper-fill' : 'ink'" />
              <line v-else-if="w.kind === KEEB_WID_RULE" :x1="w.x" :y1="w.y" :x2="w.x + w.w" :y2="w.y" class="rule" />
              <text v-else-if="w.kind === KEEB_WID_TEXT" :x="anchorX(w)" :y="textBaseline(w)" :font-size="FONT_PX[fontOf(w)]" :text-anchor="textAnchor(w)" class="ink-text">{{ textFor(w) }}</text>
              <template v-else-if="w.kind === KEEB_WID_BAR">
                <rect :x="w.x" :y="w.y" :width="w.w" :height="w.h" class="frame" />
                <rect :x="w.x" :y="w.y" :width="barFill(w)" :height="w.h" class="ink" />
              </template>
              <template v-else-if="w.kind === KEEB_WID_BATTERY">
                <rect :x="w.x" :y="w.y" :width="w.w" :height="w.h" class="frame" />
                <rect :x="w.x + w.w" :y="w.y + w.h * 0.3" :width="Math.max(1, w.h * 0.3)" :height="w.h * 0.4" class="ink" />
              </template>
              <template v-else-if="w.kind === KEEB_WID_PIPS">
                <rect v-for="n in pipCount" :key="n" :x="w.x + (n - 1) * (w.w + (w.style === 1 ? 3 : 2))" :y="w.y" :width="w.w" :height="w.h" :class="n === SAMPLE_LAYER_INDEX ? 'ink' : 'frame'" />
              </template>
              <polygon v-else-if="w.kind === KEEB_WID_BOLT" :points="`${w.x},${w.y} ${w.x + w.w},${w.y} ${w.x + w.w * 0.35},${w.y + w.h}`" class="ink" />
              <rect v-else-if="w.kind === KEEB_WID_ART" :x="w.x" :y="w.y" :width="w.w" :height="w.h" class="art" />
              <!-- The hit area, so a thin rule or a glyph is still clickable. -->
              <rect :x="w.x" :y="w.y" :width="Math.max(w.w, 4)" :height="Math.max(w.h, 4)" class="hit" />
            </g>
          </template>
        </svg>

        <p class="note">
          {{ panel.logicalW }}×{{ panel.logicalH }} logical space, rotated {{ panel.info?.rotation ?? 0 }}° into the
          {{ panel.info?.panelW ?? 0 }}×{{ panel.info?.panelH ?? 0 }} panel. Values are placeholders — layer, battery,
          link and the connected device are the keyboard's to report.
        </p>
      </div>

      <div class="editor">
        <div class="row">
          <button class="btn" :disabled="busy" :title="panel.hasLocalEdits ? `throw away ${panel.widgets.length ? 'your staged edits' : 'the staged table'}` : 'read the panel from the keyboard again'" @click="panel.reload(true)">re-read</button>
          <button class="btn push" :disabled="busy || !panel.canEdit || !panel.hasLocalEdits" title="one DISPLAY_SET with the whole table; the firmware validates every entry before drawing any of it" @click="run('apply', panel.applyTable)">
            Apply panel{{ panel.hasLocalEdits ? ' *' : '' }}
          </button>
          <button class="btn" :disabled="busy || !panel.canEdit" title="DISPLAY_SAVE: what survives a reboot" @click="run('save', panel.save)">Save</button>
          <button class="btn" :disabled="busy || !panel.canEdit" title="DISPLAY_DISCARD: back to the last saved panel" @click="run('discard', panel.discard)">Discard</button>
          <button class="btn danger" :disabled="busy || !panel.canEdit" title="DISPLAY_RESET: delete the saved panel and fall back to the preset" @click="run('reset', panel.resetStorage)">Reset</button>
          <button class="btn" :disabled="busy || !panel.canEdit" title="DISPLAY_BLANK: next paint clears the glass once" @click="run('blank', panel.blank)">Blank once</button>
        </div>

        <div class="row presets">
          <button v-for="p in panel.presets" :key="p.preset" class="btn preset" :disabled="busy || !panel.canEdit" title="restore a built-in preset: the table is replaced, your text slots are kept" @click="run(`preset ${p.name}`, () => panel.applyPreset(p.preset))">
            {{ p.name }}
          </button>
        </div>

        <div class="widgets">
          <div v-for="(w, i) in panel.widgets" :key="i" :class="['widget', { sel: i === selected }]" @click="selected = i">
            <span class="idx">{{ i }}</span>
            <span class="desc">{{ describeWidget(w.kind, w.source, KEEB_SRC_TEXT_BASE, KEEB_SRC_VALUE_BASE, panel.textSlots) }}</span>
            <span class="geo">{{ w.x }},{{ w.y }} · {{ w.w }}×{{ w.h }}</span>
            <span v-if="panel.validate(w)" class="bad" title="the firmware would refuse this">✗</span>
          </div>

          <button class="btn add" :disabled="busy || !panel.canEdit || panel.widgets.length >= panel.widgetMax" :title="`this panel holds ${panel.widgetMax} widgets`" @click="panel.addWidget(); selected = panel.widgets.length - 1">
            + widget
          </button>
        </div>

        <div v-if="sel" class="sel">
          <div class="sel-row">
            <label>kind
              <select :value="sel.kind" :disabled="!panel.canEdit" @change="patchKind">
                <option v-for="k in KIND_ORDER" :key="k" :value="k">{{ KIND_LABELS[k] }}</option>
              </select>
            </label>

            <label>source
              <select :value="sel.source" :disabled="!panel.canEdit" @change="patchSource">
                <option v-for="s in sources" :key="s" :value="s">{{ sourceLabel(s) }}</option>
              </select>
            </label>
          </div>

          <div class="sel-row geo">
            <label>x<input type="number" min="0" :max="panel.logicalW - 1" :value="sel.x" :disabled="!panel.canEdit" @change="patch('x', $event)" /></label>
            <label>y<input type="number" min="0" :max="panel.logicalH - 1" :value="sel.y" :disabled="!panel.canEdit" @change="patch('y', $event)" /></label>
            <label>w<input type="number" min="0" :max="panel.logicalW" :value="sel.w" :disabled="!panel.canEdit" @change="patch('w', $event)" /></label>
            <label>h<input type="number" min="0" :max="panel.logicalH" :value="sel.h" :disabled="!panel.canEdit" @change="patch('h', $event)" /></label>
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
                <select :value="fontOf(sel)" :disabled="!panel.canEdit" @change="patchTextFont">
                  <option v-for="(f, i) in FONT_LABELS" :key="f" :value="i">{{ f }}</option>
                </select>
              </label>
              <label>align
                <select :value="alignOf(sel)" :disabled="!panel.canEdit" @change="patchTextAlign">
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
            <button class="btn link" :disabled="!panel.canEdit" @click="panel.moveWidget(selected, selected - 1)">move up</button>
            <button class="btn link" :disabled="!panel.canEdit" @click="panel.moveWidget(selected, selected + 1)">move down</button>
            <button class="btn link danger" :disabled="!panel.canEdit" @click="panel.removeWidget(selected); selected = Math.max(0, selected - 1)">remove</button>
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
              @change="writeText(s - 1, $event)"
            />
          </div>

          <h3>value slots <small>live only — never persisted</small></h3>
          <div v-for="s in panel.valueSlots" :key="s" class="slot">
            <span class="idx">{{ s - 1 }}</span>
            <input type="number" min="-32768" max="32767" :value="panel.values[s - 1] ?? 0" :disabled="!panel.canEdit" @change="writeValue(s - 1, $event)" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel-editor { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; background: var(--bg-raised); }
header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
h2 { margin: 0; font-size: 14px; letter-spacing: 1px; }
.why, .note { font-size: 11px; color: var(--text-faint); }
.preset { font-size: 11px; color: var(--accent); }
.msg { margin-top: 8px; font-size: 12px; color: var(--text-dim); }
.msg.err { color: #c0392b; }
.empty { padding: 12px 0; }

.grid { display: grid; grid-template-columns: minmax(200px, 280px) 1fr; gap: 16px; margin-top: 10px; }
.preview { display: flex; flex-direction: column; gap: 8px; }
.screen { border: 1px solid var(--border); border-radius: 6px; background: var(--bg-inset); }
.paper { fill: var(--bg-inset); }
.ink { fill: var(--text); }
.paper-fill { fill: var(--bg-inset); stroke: var(--border); }
.ink-text { fill: var(--text); font-family: ui-sans-serif, system-ui, sans-serif; }
.frame { fill: none; stroke: var(--text); stroke-width: 1; }
.rule { stroke: var(--text); stroke-width: 1; }
.art { fill: none; stroke: var(--text); stroke-dasharray: 3 2; }
.hit { fill: transparent; cursor: pointer; }
.w.sel .hit { fill: rgba(224, 165, 27, 0.18); stroke: var(--accent); stroke-width: 1; }

.editor { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.btn { border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); cursor: pointer; font: inherit; font-size: 12px; padding: 5px 10px; }
.btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.btn:disabled { opacity: 0.4; cursor: default; }
.btn.push { border-color: var(--accent-dim); color: var(--accent); }
.btn.danger { color: #c0392b; }
.btn.link { border: none; background: none; padding: 0; font-size: 11px; color: var(--text-faint); text-decoration: underline; }
.btn.preset { font-size: 11px; }

.widgets { display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; padding: 6px; }
.widget { display: grid; grid-template-columns: 24px 1fr auto 18px; gap: 8px; align-items: center; font-size: 12px; padding: 3px 4px; border-radius: 6px; cursor: pointer; }
.widget:hover { background: var(--bg-panel); }
.widget.sel { background: var(--bg-raised); outline: 1px solid var(--accent-dim); }
.idx { color: var(--text-faint); font-variant-numeric: tabular-nums; }
.geo { color: var(--text-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.bad { color: #c0392b; }
.add { align-self: flex-start; margin-top: 4px; }

.sel { border: 1px solid var(--border); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.sel-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
label { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--text-dim); }
select, input { font: inherit; font-size: 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 3px 6px; }
input[type='number'] { width: 62px; }
input[type='text'] { flex: 1; min-width: 120px; }
.style-help { font-size: 11px; color: var(--text-faint); }

.slots h3 { margin: 6px 0 2px; font-size: 12px; }
.slots h3 small { color: var(--text-faint); font-weight: 400; }
.slot { display: grid; grid-template-columns: 24px 1fr; gap: 8px; align-items: center; }
</style>
