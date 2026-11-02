<script setup lang="ts">
/*
 * Panel editor: direct manipulation canvas + layer stack.
 *
 * The preview is the firmware's logical space, rotated into the physical panel
 * by the compositor. Widgets are drawn in z-order and can be selected by click
 * or from the layer stack. Once selected they can be dragged to move or pulled
 * by handles to resize.
 *
 * Properties (kind, source, style, text/value slots) live in the aside inspector
 * so the canvas stays clean and the properties panel is always in the same place.
 */
import { computed, ref } from 'vue'

import {
  describeWidget,
} from '../data/widgets.ts'
import {
  KEEB_SRC_LAYER_INDEX,
  KEEB_SRC_LAYER_NAME,
  KEEB_SRC_LAYER_POS,
  KEEB_SRC_BATT_LEFT,
  KEEB_SRC_BATT_LEFT_PCT,
  KEEB_SRC_BATT_RIGHT,
  KEEB_SRC_BATT_RIGHT_PCT,
  KEEB_SRC_LINK,
  KEEB_SRC_LINK_SHORT,
  KEEB_SRC_HOST,
  KEEB_SRC_CHARGING,
  KEEB_SRC_DEVICE_ID,
  KEEB_SRC_DEVICE_NAME,
  KEEB_STYLE_FONT,
  KEEB_STYLE_ALIGN,
  KEEB_WID_FRAME,
  KEEB_WID_RECT,
  KEEB_WID_RULE,
  KEEB_WID_TEXT,
  KEEB_WID_BAR,
  KEEB_WID_BATTERY,
  KEEB_WID_PIPS,
  KEEB_WID_BOLT,
  KEEB_WID_ART,
  KEEB_SRC_TEXT_BASE,
  KEEB_SRC_VALUE_BASE,
} from '../proto/constants.ts'
import { useDisplayStore } from '../stores/display.ts'
import type { Widget } from '../proto/types.ts'

const panel = useDisplayStore()

const busy = ref(false)
const message = ref('')

const SAMPLE_LAYERS = 5
const SAMPLE_LAYER_INDEX = 2
const SAMPLE_LAYER_NAME = 'RAISE'
const SAMPLE_LEFT = 84
const SAMPLE_RIGHT = 61
const SAMPLE_DEVICE = '2'

const pipCount = computed(() => panel.layerCount || SAMPLE_LAYERS)

const scale = computed(() => Math.max(1, Math.min(4, 380 / Math.max(1, panel.logicalH))))
const viewW = computed(() => panel.logicalW * scale.value)
const viewH = computed(() => panel.logicalH * scale.value)

const sel = computed<Widget | null>(() => panel.widgets[panel.selectedWidget] ?? null)

const hidden = ref<Set<number>>(new Set())

const fontOf = (w: Widget): number => KEEB_STYLE_FONT(w.style)
const alignOf = (w: Widget): number => KEEB_STYLE_ALIGN(w.style)

const FONT_PX = [8, 16, 26]

function textFor(w: Widget): string {
  if (w.source >= KEEB_SRC_TEXT_BASE) {
    return panel.texts[w.source - KEEB_SRC_TEXT_BASE] ?? ''
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
  if (align === 1) return w.x + w.w / 2
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

/* ---------------------------------------------------------------- drag
 *  Direct manipulation: move by drag, resize by handle pull.              */

type DragKind = 'move' | 'nw' | 'ne' | 'sw' | 'se'

const dragging = ref<DragKind | null>(null)
const dragOrigin = ref({ x: 0, y: 0, w: 0, h: 0, px: 0, py: 0 })

function startDrag(kind: DragKind, i: number, ev: PointerEvent): void {
  if (!panel.canEdit) return
  panel.selectedWidget = i
  const w = panel.widgets[i]
  dragging.value = kind
  dragOrigin.value = { x: w.x, y: w.y, w: w.w, h: w.h, px: ev.clientX, py: ev.clientY }
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', endDrag)
  if ((ev.target as HTMLElement).setPointerCapture) (ev.target as HTMLElement).setPointerCapture(ev.pointerId)
}

function onDrag(ev: PointerEvent): void {
  if (!dragging.value || !sel.value) return
  const dx = Math.round((ev.clientX - dragOrigin.value.px) / scale.value)
  const dy = Math.round((ev.clientY - dragOrigin.value.py) / scale.value)
  const kind = dragging.value

  let x = dragOrigin.value.x
  let y = dragOrigin.value.y
  let w = dragOrigin.value.w
  let h = dragOrigin.value.h

  if (kind === 'move') {
    x = dragOrigin.value.x + dx
    y = dragOrigin.value.y + dy
  } else {
    if (kind.includes('e')) w = Math.max(1, dragOrigin.value.w + dx)
    if (kind.includes('w')) {
      w = Math.max(1, dragOrigin.value.w - dx)
      x = dragOrigin.value.x + dx
    }
    if (kind.includes('s')) h = Math.max(1, dragOrigin.value.h + dy)
    if (kind.includes('n')) {
      h = Math.max(1, dragOrigin.value.h - dy)
      y = dragOrigin.value.y + dy
    }
  }

  const maxW = panel.logicalW
  const maxH = panel.logicalH
  x = Math.max(0, Math.min(x, maxW - 1))
  y = Math.max(0, Math.min(y, maxH - 1))
  if (x + w > maxW) w = maxW - x
  if (y + h > maxH) h = maxH - y

  panel.edit(panel.selectedWidget, { x, y, w, h })
}

function endDrag(): void {
  dragging.value = null
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', endDrag)
}

/* ---------------------------------------------------------------- layer stack */

function toggleVis(i: number): void {
  const next = new Set(hidden.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  hidden.value = next
}

function isHidden(i: number): boolean {
  return hidden.value.has(i)
}

function widgetStyleWhy(w: Widget): string {
  return panel.validate(w)
}
</script>

<template>
  <section class="panel-editor">
    <div v-if="message" class="msg">{{ message }}</div>
    <div v-if="panel.lastError" class="msg err">{{ panel.lastError }}</div>

    <div v-if="!panel.loaded" class="empty">
      <button class="btn" :disabled="busy || !panel.canEdit" @click="panel.load()">Read the panel from the keyboard</button>
    </div>

    <div v-else class="grid">
      <!-- Canvas ---------------------------------------------------------- -->
      <div class="preview">
        <svg
          :width="viewW"
          :height="viewH"
          :viewBox="`0 0 ${panel.logicalW} ${panel.logicalH}`"
          class="screen"
          @pointerdown="panel.selectedWidget = -1"
        >
          <rect x="0" y="0" :width="panel.logicalW" :height="panel.logicalH" class="paper" />

          <template v-for="(w, i) in panel.widgets" :key="i">
            <g v-if="!isHidden(i)" :class="['w', { sel: i === panel.selectedWidget }]">
              <!-- The visual. Widgets earlier in the list paint first (background). -->
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

              <!-- Hit area on top of everything so selection works. -->
              <rect
                :x="w.x"
                :y="w.y"
                :width="Math.max(w.w, 4)"
                :height="Math.max(w.h, 4)"
                class="hit"
                @pointerdown.stop="startDrag('move', i, $event)"
              />

              <!-- Handles when selected. -->
              <template v-if="i === panel.selectedWidget && panel.canEdit">
                <rect :x="w.x - 2" :y="w.y - 2" width="4" height="4" class="handle nw" @pointerdown.stop="startDrag('nw', i, $event)" />
                <rect :x="w.x + w.w - 2" :y="w.y - 2" width="4" height="4" class="handle ne" @pointerdown.stop="startDrag('ne', i, $event)" />
                <rect :x="w.x - 2" :y="w.y + w.h - 2" width="4" height="4" class="handle sw" @pointerdown.stop="startDrag('sw', i, $event)" />
                <rect :x="w.x + w.w - 2" :y="w.y + w.h - 2" width="4" height="4" class="handle se" @pointerdown.stop="startDrag('se', i, $event)" />
              </template>
            </g>
          </template>
        </svg>

      </div>

      <!-- Stack ----------------------------------------------------------- -->
      <div class="stack">
        <div class="row">
          <button class="btn" :disabled="busy" :title="panel.hasLocalEdits ? 'throw away your staged edits' : 'read the panel from the keyboard again'" @click="panel.reload(true)">re-read</button>
          <button class="btn push" :disabled="busy || !panel.canEdit || !panel.hasLocalEdits" title="one DISPLAY_SET with the whole table" @click="run('apply', panel.applyTable)">
            Apply{{ panel.hasLocalEdits ? ' *' : '' }}
          </button>
          <button class="btn" :disabled="busy || !panel.canEdit" title="DISPLAY_SAVE" @click="run('save', panel.save)">Save</button>
          <button class="btn" :disabled="busy || !panel.canEdit" title="DISPLAY_DISCARD" @click="run('discard', panel.discard)">Discard</button>
          <button class="btn danger" :disabled="busy || !panel.canEdit" title="DISPLAY_RESET" @click="run('reset', panel.resetStorage)">Reset</button>
          <button class="btn" :disabled="busy || !panel.canEdit" title="DISPLAY_BLANK" @click="run('blank', panel.blank)">Blank once</button>

          <select
            class="preset-select"
            :disabled="busy || !panel.canEdit"
            @change="(e: Event) => {
              const val = Number((e.target as HTMLSelectElement).value)
              const name = panel.presets.find((p) => p.preset === val)?.name ?? String(val)
              run(`preset ${name}`, () => panel.applyPreset(val))
              ;(e.target as HTMLSelectElement).selectedIndex = 0
            }"
          >
            <option value="" disabled selected>presets</option>
            <option v-for="p in panel.presets" :key="p.preset" :value="p.preset">
              {{ p.name }}
            </option>
          </select>
        </div>

        <div class="layers">
          <div class="head-row">
            <span class="h-idx">#</span>
            <span class="h-desc">widget</span>
            <span class="h-geo">pos · size</span>
            <span class="h-bad" />
            <span class="h-vis" title="visible in preview">vis</span>
          </div>
          <div v-for="(w, i) in panel.widgets" :key="i" :class="['widget', { sel: i === panel.selectedWidget, invalid: widgetStyleWhy(w) }]">
            <span class="idx">{{ i }}</span>
            <span class="desc" @click="panel.selectedWidget = i">{{ describeWidget(w.kind, w.source, KEEB_SRC_TEXT_BASE, KEEB_SRC_VALUE_BASE, panel.textSlots) }}</span>
            <span class="geo">{{ w.x }},{{ w.y }} · {{ w.w }}×{{ w.h }}</span>
            <span v-if="widgetStyleWhy(w)" class="bad" title="invalid">✗</span>
            <span v-else class="bad ok" />
            <button
              class="toggle"
              :class="{ on: !isHidden(i) }"
              :title="isHidden(i) ? 'show in preview' : 'hide in preview'"
              @click="toggleVis(i)"
            >
              <span class="knob" />
            </button>
          </div>

          <button class="btn add" :disabled="busy || !panel.canEdit || panel.widgets.length >= panel.widgetMax" :title="`this panel holds ${panel.widgetMax} widgets`" @click="panel.addWidget(); panel.selectedWidget = panel.widgets.length - 1">
            + widget
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel-editor {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 0;
  padding: 16px 14px 12px;
  background: var(--bg-raised);
}

.panel-editor::before {
  content: 'status panel';
  position: absolute;
  top: -10px;
  left: 14px;
  padding: 0 6px;
  background: var(--paper);
  color: var(--mid);
  font-size: 12px;
  letter-spacing: 0.05em;
}

.msg { margin-top: 0; font-size: 12px; color: var(--text-dim); }
.msg { margin-top: 8px; font-size: 12px; color: var(--text-dim); }
.msg.err { color: var(--err); }
.empty { padding: 12px 0; }

.grid { display: grid; grid-template-columns: minmax(260px, 400px) 1fr; gap: 16px; margin-top: 10px; }
.preview { display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; min-height: 0; }
.screen { border: 1px solid var(--border); border-radius: 0; background: var(--bg-inset); user-select: none; }
.paper { fill: var(--bg-inset); }
.ink { fill: var(--text); }
.paper-fill { fill: var(--bg-inset); stroke: var(--border); }
.ink-text { fill: var(--text); font-family: ui-sans-serif, system-ui, sans-serif; }
.frame { fill: none; stroke: var(--text); stroke-width: 1; }
.rule { stroke: var(--text); stroke-width: 1; }
.art { fill: none; stroke: var(--text); stroke-dasharray: 3 2; }
.hit { fill: transparent; cursor: grab; }
.hit:active { cursor: grabbing; }
.w.sel .hit { fill: rgba(201, 209, 217, 0.14); stroke: var(--ink); stroke-width: 1; }

.handle { fill: var(--accent); stroke: var(--bg-inset); stroke-width: 1; cursor: nwse-resize; pointer-events: all; }
.handle.nw, .handle.se { cursor: nwse-resize; }
.handle.ne, .handle.sw { cursor: nesw-resize; }

.stack { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.btn { border: 1px solid var(--border); border-radius: 0; background: var(--bg); color: var(--text); cursor: pointer; font: inherit; font-size: 12px; padding: 5px 10px; }
.btn:hover:not(:disabled) { border-color: var(--ink); color: var(--ink); }
.btn:disabled { opacity: 0.62; cursor: default; }
.btn.push { border-color: var(--accent-dim); color: var(--accent); }
.btn.danger { border-color: var(--accent-dim); color: var(--accent); }
.preset-select {
  margin-left: auto;
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 0;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.preset-select:disabled {
  opacity: 0.62;
  cursor: default;
}
.preset-select option { background: var(--bg); color: var(--text); }

.layers { display: flex; flex-direction: column; gap: 0; max-height: 360px; overflow: auto; border: 1px solid var(--border); border-radius: 0; padding: 0; background: var(--bg-inset); }
.widget {
  display: grid;
  grid-template-columns: 28px 1fr 110px 22px 32px;
  gap: 4px;
  align-items: center;
  font-size: 12px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  cursor: default;
  min-height: 32px;
}
.head-row {
  display: grid;
  grid-template-columns: 28px 1fr 110px 22px 32px;
  gap: 4px;
  align-items: center;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mid);
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-raised);
  position: sticky;
  top: 0;
  z-index: 1;
}
.widget:last-child { border-bottom: 0; }
.widget:hover { background: var(--bg-panel); }
.widget.sel { background: var(--bg-raised); border-left: 3px solid var(--accent); padding-left: 5px; }
.widget.invalid { background: rgba(var(--err-rgb, 255, 80, 80), 0.06); }
.toggle {
  position: relative;
  width: 28px;
  height: 14px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg);
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.toggle.on { background: var(--ink); border-color: var(--ink); }
.toggle:not(.on) { background: var(--bg-inset); }
.knob {
  position: absolute;
  left: 1px;
  width: 10px;
  height: 10px;
  background: var(--text);
  border-radius: 50%;
  transition: left 0.12s ease, background 0.12s ease;
}
.toggle.on .knob { left: 15px; background: var(--on-ink); }
.toggle:hover:not(:disabled) { border-color: var(--ink); }
.idx {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  text-align: center;
}
.desc {
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.geo {
  color: var(--text-faint);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-family: var(--mono, ui-monospace, monospace);
}
.bad {
  color: var(--err);
  font-size: 13px;
  text-align: center;
}
.add {
  align-self: stretch;
  margin: 0;
  padding: 8px;
  border: 1px dashed var(--border);
  border-radius: 0;
  background: transparent;
  color: var(--mid);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.add:hover:not(:disabled) { border-color: var(--ink); color: var(--ink); }
.add:disabled { opacity: 0.62; cursor: default; }
</style>
