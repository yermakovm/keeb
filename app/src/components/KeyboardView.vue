<script setup lang="ts">
/*
 * The grid, drawn where the keys actually are.
 *
 * Positions come from the matrix transform's map (keeb.dtsi), and the map is
 * written in physical order: the left half lists columns 0-5 from its outer edge
 * to the split gap, the right half lists 11-6 from the gap to its outer edge.
 * `placeKeys()` reproduces that order, so a cap lands in the same slot it
 * occupies on the board, and the position number a CELLS record carries means
 * the same key here and in the firmware.
 *
 * The arrangement itself is a preset (model/layouts.ts). The default, cosmotyl,
 * is read back out of the generated grid, so it cannot disagree with the board;
 * the others are real boards, and a preset that has no slot for a position the
 * keyboard reports says so in the header instead of dropping the key.
 *
 * The case is drawn as an outline: one rectangle for the whole board, one per
 * half, no fill and no corner radius, each name punched into its own border.
 */
import { computed, ref } from 'vue'

import Keycap from './Keycap.vue'
import { describeBinding } from '../model/cap.ts'
import { DEFAULT_LAYOUT, findLayout, placeKeys } from '../model/layouts.ts'
import { useKeymapStore } from '../stores/keymap.ts'
import { GRID, KEY_COUNT } from '../proto/zmk.gen.ts'

const props = withDefaults(
  defineProps<{
    selectedPos: number | null
    /** 'tester' lights the caps the keyboard reports instead of the one you are editing. */
    mode?: 'edit' | 'tester'
    /** Positions the keyboard currently has closed (tester mode). */
    held?: number[]
    /** Positions the keyboard has never reported (tester mode): drawn recessed
     * and dashed, so a dead switch is visible on the board instead of in a list. */
    unreported?: number[]
    /** The status panels this board has, in the order they should be drawn. */
    panels?: Array<{ id: string; side: 'left' | 'right'; label: string; note: string }>
    selectedPanel?: string | null
  }>(),
  { mode: 'edit', held: () => [], unreported: () => [], panels: () => [], selectedPanel: null },
)

const emit = defineEmits<{
  (e: 'pick', pos: number, own: boolean): void
  (e: 'pick-panel', id: string): void
  (e: 'drop', pos: number): void
}>()

const keymap = useKeymapStore()

const layoutId = ref(DEFAULT_LAYOUT)
const layout = computed(() => findLayout(layoutId.value))

const positions = computed(() => GRID.map((g) => g.pos))

const placed = computed(() => placeKeys(layout.value, positions.value))

const heldSet = computed(() => new Set(props.held))

const unreportedSet = computed(() => new Set(props.unreported))

/* The caps have two presentations, not two behaviours: the editor draws the
 * binding plus the marks of an edit in progress, the tester draws the binding
 * alone. Clicking is the same in both — it selects the position — but in the
 * tester that selection is a read, and the aside says so. */
const variant = computed(() => (props.mode === 'tester' ? 'test' : 'edit'))

const layerLabel = computed(() => keymap.editingName)

/* A layer selector reads a layer against the base one: keys this layer
 * redefines stay lit, keys that just re-assert the base layer fade away. The
 * base layer itself and the read-only tester have nothing to compare, so this
 * is an edit-mode concern only. */
const diffing = computed(
  () => props.mode !== 'tester' && keymap.editingSlot > 0,
)

const mismatch = computed(() => {
  if (placed.value.fits) {
    return ''
  }

  return placed.value.overflow.length
    ? `${layout.value.label} has ${placed.value.overflow.length} slot(s) too few for ${KEY_COUNT} positions: ${placed.value.overflow.join(', ')} are drawn below`
    : `${layout.value.label} draws ${placed.value.empty} slot(s) this board has no switch for`
})

const cell = (pos: number | null) => {
  if (pos === null) {
    return null
  }

  const own = keymap.ownCell(keymap.editingSlot, pos) !== null
  const resolved = keymap.resolve(keymap.editingSlot, pos)

  return {
    pos,
    display: describeBinding(resolved?.binding ?? null, keymap.layerName),
    own,
    reserved: keymap.isReserved(pos),
    /* In the editor a cap is inverted because you are pointing at it. In the
     * tester it is inverted because the keyboard says it is closed right now.
     * Same visual, different fact, and the header says which one you are reading. */
    selected: props.mode === 'tester' ? heldSet.value.has(pos) : props.selectedPos === pos,
    pending: keymap.isPending(keymap.editingSlot, pos),
    /* A layer selector compares against the base layer (slot 0): a key this
     * layer redefines is lit, a key that re-asserts base behaviour is faded. */
    override: diffing.value && keymap.layerDiff(keymap.editingSlot, pos) === 'override',
    same: diffing.value && keymap.layerDiff(keymap.editingSlot, pos) === 'same',
    /* Only the tester knows whether a switch has ever closed, so only the
     * tester says so: in the editor an unreported position is not a finding. */
    unreported: props.mode === 'tester' && unreportedSet.value.has(pos),
    inspected: props.mode === 'tester' && props.selectedPos === pos,
  }
}

/* Columns drawn: a preset may stagger a column out, so the width is the widest
 * row, not the preset's nominal column count. */
const cols = computed(() =>
  Math.max(layout.value.cols, ...layout.value.rows.map((r) => (r.slots.length ? Math.max(...r.slots) + 1 : 0))),
)

/* Fallback for a preset that ran out of slots: the leftover positions in a strip
 * under the board, so a mismatch is visible rather than silent. */
const overflow = computed(() => placed.value.overflow.map(cell))

/* Each half's screen strip sits against that half's inner column — the column
 * next to T·G on the left and Y·H on the right — and it is drawn tall because
 * that is the orientation the glass is in. It is a button, not decoration:
 * clicking one is how you get to its editor. */
const panelRows = computed(() => Math.min(4, placed.value.rows.length || 4))

/** The two halves, in draw order. Each frame carries its own screen strip. */
const HALF_SIDES = ['left', 'right'] as const
</script>

<template>
  <div class="keyboard" :style="{ '--cols': cols }">

    <p v-if="mismatch" class="mismatch">{{ mismatch }}</p>

    <!-- The case: one outline around the whole board, one per half. Nothing is
         filled, because the only thing worth colouring here is state.

         The halves are outlines drawn *over* a row-interleaved grid, not containers
         holding their own rows. That is not decoration: the transform's map order is
         row 0 left, row 0 right, row 1 left, ... and a view that groups a half's rows
         together draws the caps in an order that is not the order the firmware lists
         them in. -->
    <div class="case" :data-layout="layout.id">
      <div class="board">
        <div v-for="line in placed.rows" :key="`row${line.index}`" class="row" :style="{ marginTop: line.drop ? `calc(var(--cell) * ${line.drop})` : undefined }">
          <div class="cells left">
            <template v-for="(pos, slot) in line.left" :key="`L${line.index}-${slot}`">
              <Keycap
                v-if="pos !== null"
                :pos="pos"
                :display="cell(pos)!.display"
                :own="cell(pos)!.own"
                :reserved="cell(pos)!.reserved"
                :selected="cell(pos)!.selected"
                :pending="cell(pos)!.pending"
                :override="cell(pos)!.override"
                :same="cell(pos)!.same"
                :unreported="cell(pos)!.unreported"
                :inspected="cell(pos)!.inspected"
                :variant="variant"
                :show-pos="false"
                :layer-label="layerLabel"
                @pick="(p) => emit('pick', p, cell(p)!.own)"
                @drop="(p) => emit('drop', p)"
              />
              <div v-else class="slot" :title="`no switch at row ${line.index} slot ${slot} in this layout`" />
            </template>
          </div>

          <div class="cells right">
            <template v-for="(pos, slot) in line.right" :key="`R${line.index}-${slot}`">
              <Keycap
                v-if="pos !== null"
                :pos="pos"
                :display="cell(pos)!.display"
                :own="cell(pos)!.own"
                :reserved="cell(pos)!.reserved"
                :selected="cell(pos)!.selected"
                :pending="cell(pos)!.pending"
                :override="cell(pos)!.override"
                :same="cell(pos)!.same"
                :unreported="cell(pos)!.unreported"
                :inspected="cell(pos)!.inspected"
                :variant="variant"
                :show-pos="false"
                :layer-label="layerLabel"
                @pick="(p) => emit('pick', p, cell(p)!.own)"
                @drop="(p) => emit('drop', p)"
              />
              <div v-else class="slot" :title="`no switch at row ${line.index} slot ${slot} in this layout`" />
            </template>
          </div>
        </div>

        <!-- Each half's frame owns that half's screen. The display is part of
             the half's case, not something standing loose in the gap between
             the two, so the frame is widened to enclose the strip and the DOM
             says the same thing the drawing says.

             The frame itself stays click-through; only the strip inside it
             takes clicks. -->
        <div v-for="half in HALF_SIDES" :key="half" :class="['frame', half]">
          <span class="half" aria-hidden="true">{{ half }}.half</span>

          <button
            v-for="p in panels.filter((p) => p.side === half)"
            :key="p.id"
            :class="['panel', p.side, { sel: selectedPanel === p.id }]"
            :style="{ height: `calc(${panelRows} * var(--cell) + ${panelRows - 1} * var(--gap))` }"
            :title="`${p.label} — ${p.note}`"
            :aria-label="`${p.label}: ${p.note}`"
            :aria-pressed="selectedPanel === p.id"
            @click="emit('pick-panel', p.id)"
          >
            <!-- The screen is drawn, not named. Which half it belongs to is already
                 said by the frame it sits inside, what is on it is said by its own
                 editor, and the strip is one key wide — a name and a count in that
                 width was vertical text you had to turn your head to read. -->
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="2" y="4" width="20" height="13" />
              <path d="M9 21h6M12 17v4" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div v-if="overflow.length" class="overflow">
      <span>not placed by {{ layout.label }}</span>
      <div class="strip">
        <Keycap
          v-for="c in overflow"
          :key="c!.pos"
          :pos="c!.pos"
          :display="c!.display"
          :own="c!.own"
          :reserved="c!.reserved"
          :selected="c!.selected"
          :pending="c!.pending"
          :override="c!.override"
          :same="c!.same"
          :unreported="c!.unreported"
          :inspected="c!.inspected"
          :variant="variant"
          :show-pos="true"
          :layer-label="layerLabel"
          @pick="(p) => emit('pick', p, c!.own)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.keyboard {
  --cell: 68px;
  --pad: 12px;
  --case-pad: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  /* The case is a size query target: the board is drawn to fit the space it
   * has, which is what makes the scroll in it unnecessary. */
  container-type: inline-size;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--mid);
}

.pick { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

select {
  padding: 3px 8px;
  background: var(--bg-inset);
  border: 1px solid var(--line);
  border-radius: var(--r);
  color: var(--ink);
  font: inherit;
  font-size: 12px;
}

.note { color: var(--mid); }

.cmd {
  border: 1px solid var(--line);
  border-radius: 999px;
  background: transparent;
  color: var(--mid);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 12px;
}

.cmd:hover { border-color: var(--ink); }
.cmd[aria-pressed='true'] { background: #1e2733; color: var(--ink); border-color: rgba(110, 231, 160, 0.6); box-shadow: inset 0 -3px 0 var(--accent); }

.mismatch {
  margin: 0;
  padding: 6px 12px;
  border: 1px solid var(--err);
  border-radius: 10px;
  color: var(--err);
  font-size: 12px;
}

/* The case. One warm rounded board around two half-cases, each frame holding its
 * own keys and its own screen, with the cut between them left as empty stage.
 * The layout's name is punched into the top border the way every titled box
 * here is titled. The board sits a touch taller than the paper it floats on,
 * like the keyboard on the bench. */
.case {
  position: relative;
  border: 0;
  background: transparent;
  box-shadow: none;
  padding: 26px var(--case-pad) 20px;

  /* No scroll here, and nothing clipped: a keyboard you have to drag sideways
   * to read is a keyboard you cannot check, so the cell size is derived from the
   * width the case actually has — two halves of --cols keys, one screen strip of
   * one key inside each frame, the frame padding each half keeps on both sides
   * of its own contents, the gap between a grid and its strip, and the cut
   * between the two cases — capped at the comfortable 46px. */
  --fit: calc(
    (100cqw - 2 * var(--case-pad) - 2px - 4 * var(--pad)
      - (2 * var(--cols) + 2) * var(--gap)) / (2 * var(--cols) + 2)
  );
  --cell: clamp(20px, var(--fit), 68px);
  /* The half and frame widths belong here, not on .keyboard: a custom property
   * is substituted where it is *declared*, so declaring them against the 46px
   * fallback above measured the halves at 46px cells while the grid drew them at
   * the clamped size. The two panel strips — one measured from the left edge, one
   * from the right — then landed on the same pixels and the later one covered the
   * first. Anything that positions something inside the case is derived from the
   * cell the case actually uses. */
  --half-w: calc(var(--cols) * var(--cell) + (var(--cols) - 1) * var(--gap));
  /* One key wide: the footprint of two keys stacked. */
  --panel-w: var(--cell);
  /* A frame is its half's padding, the keys, a gap, and that half's screen. The
   * strip is inside the outline, so the outline has to be wide enough to own it:
   * this is the number that keeps a screen from standing outside its own case. */
  --frame-w: calc(2 * var(--pad) + var(--half-w) + var(--gap) + var(--panel-w));
  /* The cut between the two cases. Each frame already carries its own strip and
   * the padding either side of it, so the cut only has to add what is left:
   * exactly enough for the two frames to meet, plus a gap of clear air. */
  --split: calc(2 * var(--panel-w) + 2 * var(--pad) + 4 * var(--gap));
}

.board {
  position: relative;
  width: fit-content;
  margin: 0 auto;
  padding: calc(var(--pad) + 10px) var(--pad);
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}

.row {
  display: flex;
  align-items: flex-start;
  gap: var(--split);
}

.cells {
  display: grid;
  grid-template-columns: repeat(var(--cols), var(--cell));
  grid-auto-rows: var(--cell);
  gap: var(--gap);
  width: var(--half-w);
}

/* The halves, drawn over the grid. Absolutely positioned so the grid can stay
 * interleaved row by row, which is the order the transform lists positions in.
 * Widths come from the same variables the grid uses, so the outlines cannot
 * drift from the keys they enclose. The frame is a boundary, not a hit target:
 * it is drawn over the caps, and only the screen strip inside it takes clicks. */
.frame {
  position: absolute;
  top: var(--pad);
  bottom: var(--pad);
  width: var(--frame-w);
  border: 0;
  pointer-events: none;
}

.frame.left { left: 0; }
.frame.right { right: 0; }

/* The half-caption is gone with the borders; the spans linger only so the DOM
 * matches the drawing, and must not paint. */
.frame > .half { display: none; }

/* A drawn slot with no switch in it. */
.slot {
  width: var(--cell);
  height: var(--cell);
  border: 1px dotted var(--soft);
  border-radius: var(--r);
  background: transparent;
}

/* The status screens: one strip inside each half's frame, against the inner
 * column. Offsets are measured from the frame's own edge, and every one of them
 * is one pixel short of the round number it stands for, because a frame's
 * border sits outside the box its children are laid out in. */
.panel {
  position: absolute;
  top: 10px;
  width: var(--panel-w);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: linear-gradient(160deg, #2c333c, #171b21);
  color: var(--ink);
  font: inherit;
  padding: 2px;
  cursor: pointer;
  overflow: hidden;
  pointer-events: auto;
}

.frame.left > .panel { right: calc(var(--pad) - 1px); }
.frame.right > .panel { left: calc(var(--pad) - 1px); }

/* Scaled to the cell the board is actually drawn at: the strip is one key wide,
 * and at the narrow end of the clamp a fixed 22px glyph would not fit in it. */
.panel svg {
  width: min(22px, calc(var(--cell) * 0.58));
  height: min(22px, calc(var(--cell) * 0.58));
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
}

.panel:hover { background: var(--mod); }

/* Same inversion a selected cap uses: a panel you are editing is lit the way a
 * key you are editing is lit. */
.panel.sel {
  background: linear-gradient(160deg, #9deab8, var(--accent-deep));
  color: var(--on-accent);
  border-color: transparent;
  box-shadow: 0 0 22px var(--accent-dim);
}

.overflow { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--err); }
.overflow .strip { display: flex; gap: var(--gap); flex-wrap: wrap; }
.overflow .strip > * { width: var(--cell); }

@media (max-width: 900px) {
  .keyboard { --case-pad: 12px; }
  .case { padding: 22px var(--case-pad) 16px; }
}

@media (max-width: 700px) {
  .keyboard { --pad: 8px; --case-pad: 8px; }
  .case { padding: 18px var(--case-pad) 12px; }
}
</style>
