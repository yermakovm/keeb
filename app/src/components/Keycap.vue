<script setup lang="ts">
/*
 * One key position on the grid.
 *
 * `pos` is the stock position number — the same number a keeb_cell carries —
 * and the label is derived from the binding's token + params, never stored.
 *
 * Where the cap sits is not this component's business: KeyboardView places it,
 * straight from the matrix transform's map order.
 *
 * Visually a cap is a cell in a table, not a keycap: flat, one hairline, no
 * shadow, no radius. The accent is reserved for state — the layer that owns the
 * cell, the selection, a staged edit.
 */
import { computed, ref } from 'vue'

import type { CapDisplay } from '../model/cap.ts'

const props = withDefaults(
  defineProps<{
    pos: number
    display: CapDisplay
    own: boolean
    reserved: boolean
    /** layer-diff view: this layer redefines this key against the base layer */
    override?: boolean
    /** layer-diff view: this key re-asserts the base layer's behaviour */
    same?: boolean
    selected: boolean
    /** this cell has a staged edit that has not been written to the keyboard */
    pending: boolean
    /** print the stock position number, for matching a CELLS record to a cap */
    showPos: boolean
    layerLabel: string
    /** tester mode: this position has never closed once, i.e. the keyboard has
     * never reported it. A dead switch, a dead column or a diode on the wrong
     * row all look like this. */
    unreported?: boolean
    /** 'test' is the read-only variant: what the key *is*, with none of the
     * marks that describe an edit in progress. */
    variant?: 'edit' | 'test'
    /** tester mode: this is the cap whose settings the aside is reading out.
     * A separate mark from `selected`, which in the tester means closed. */
    inspected?: boolean
  }>(),
  { unreported: false, variant: 'edit', inspected: false, override: false, same: false },
)

const emit = defineEmits<{
  (e: 'pick', pos: number): void
  (e: 'drop', pos: number): void
}>()

const over = ref(false)

const test = computed(() => props.variant === 'test')

const isLayerMove = computed(() => props.display.category === 'layer')

const title = computed(() => {
  const { display } = props
  const cap = display.hold ? `${display.main}/${display.hold}` : display.main
  const hint = display.hint ? ` (${display.hint})` : ''

  /* The editor's title is about the write you are about to make, so a reserved
   * position answers with why it cannot be written. The tester has no write to
   * make: its title says what the key is, and whether the keyboard has ever
   * reported it. */
  if (test.value) {
    const silent = props.unreported ? ' · never reported by the keyboard' : ''

    return `position ${props.pos} · ${display.tokenName} · ${cap}${hint}${silent}`
  }

  if (props.reserved) {
    return `position ${props.pos}: reserved position — the firmware will not rebind it`
  }

  const staged = props.pending ? ' · staged, not written yet' : ''

  return `${props.layerLabel} · position ${props.pos} · ${cap}${hint} · ${display.tokenName}${staged}`
})
</script>

<template>
  <!-- The read-only variant drops the marks of an edit in progress: `pending`
       (a staged write) and `reserved` (a write the firmware refuses). Both are
       statements about editing, and the tester is not editing anything. -->
  <button
    class="cap"
    :class="[
      `cat-${display.category}`,
      {
        own,
        inherit: !own && !reserved,
        selected,
        override,
        dim: same && !selected,
        reserved: !test && reserved,
        pending: !test && pending,
        unreported,
        inspected,
        mod: display.category === 'mod',
        mo: isLayerMove,
        'drag-over': over,
      },
      display.hold ? 'holdtap' : '',
    ]"
    :title="title"
    @click="emit('pick', pos)"
    @dragover.prevent.stop="over = true"
    @dragleave="over = false"
    @drop.prevent.stop="over = false; emit('drop', pos)"
  >
    <span v-if="showPos || (reserved && !test)" class="corner">
      <span v-if="showPos" class="pos-num">{{ pos }}</span>
      <span v-if="reserved && !test" class="lock" title="reserved">#</span>
    </span>

    <span v-if="display.hold" class="hold">{{ display.hold }}</span>
    <span class="main">{{ display.main }}</span>
    <span v-if="!own" class="src-dot" />
    <span v-if="pending && !test" class="pending-dot" title="staged edit - apply writes it" />
  </button>
</template>

<style scoped>
/* A keycap, not a cell: warm keycap gradient, soft rounded corner, a hint of
 * height from the drop shadow and the inner top highlight. The amber accent is
 * reserved for selection — the thing you are pointing at. */
.cap {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: var(--r);
  background: linear-gradient(160deg, #2c333c, #171b21);
  color: var(--ink);
  font-family: var(--sans);
  font-size: clamp(11px, calc(var(--cell) * 0.3), 20px);
  font-weight: 500;
  display: grid;
  place-items: center;
  padding: 0;
  cursor: pointer;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
}

.cap:not(:disabled):hover {
  border-color: rgba(110, 231, 160, 0.55);
  transform: translateY(-1px);
}

/* A tile dragged over this cap lights it up as the drop target. */
.cap.drag-over {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent), 0 0 22px var(--accent-dim);
}

.main {
  line-height: 1.05;
  text-align: center;
  word-break: break-word;
}

.hold {
  position: absolute;
  top: 3px;
  right: 5px;
  font-size: 9px;
  font-weight: 600;
  color: var(--cap-text-hold);
}

/* Modifiers read as dimmer, flatter cells than plain keys. */
.cap.mod {
  background: var(--cap-mod-top);
  color: var(--cap-text-hold);
}

/* A layer move is emphasised the way the rest of the page emphasises things:
 * weight and a warm filled ground. */
.cap.mo {
  background: var(--cap-layer-top);
  color: var(--ink);
  font-weight: 700;
}

/* Hold/tap: the split stays a hairline, hold top-right, tap bottom-left. */
.cap.holdtap {
  background: linear-gradient(
    to top right,
    transparent 0 calc(50% - 1px),
    var(--soft) calc(50% - 1px) calc(50% + 1px),
    transparent calc(50% + 1px) 100%
  );
}

.cap.holdtap .main { align-self: flex-end; margin-left: -8%; margin-bottom: 4%; }

/* This layer defines the cell: the border is the stronger warm grey. */
.cap.own { border-color: var(--border-strong); }

/* Recessive, but still readable. */
.cap.inherit { opacity: 0.62; }

/* Layer-diff view: a key this layer redefines against the base layer is lit
 * with an accent outline plus a ground-line under the label. The base layer and
 * the tester never hold these classes, so nothing changes there. */
.cap.override {
  border-color: rgba(110, 231, 160, 0.6);
  box-shadow: 0 0 0 1px rgba(110, 231, 160, 0.15), 0 0 16px rgba(110, 231, 160, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.cap.override::after {
  content: '';
  position: absolute;
  left: 3px;
  right: 3px;
  bottom: 3px;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
}

/* Layer-diff view: a key that just re-asserts the base layer is faded into the
 * background, so the eye lands on this layer's actual redefinitions. */
.cap.dim {
  opacity: 0.45;
  filter: saturate(0.55);
}

/* A reserved position carries a double hairline and the # in its corner. */
.cap.reserved { border-style: double; border-width: 3px; }

/* Selection is the light: a selected cap is lit warm amber instead of inverted.
 * Filling it with the accent made the selected cap look like a different
 * binding rather than the one you are looking at — the amber glow reads as the
 * spotlight falling on the key you are about to change. */
.cap.selected {
  background: linear-gradient(160deg, #9deab8, var(--accent-deep));
  border-color: transparent;
  color: var(--on-accent);
  font-weight: 700;
  box-shadow: 0 0 26px rgba(46, 184, 114, 0.5), 0 4px 10px rgba(0, 0, 0, 0.5);
}

.cap.selected.mod,
.cap.selected.mo {
  background: linear-gradient(160deg, #9deab8, var(--accent-deep));
  color: var(--on-accent);
}

/* Every mark inside the cap reads against the lit ground. */
.cap.selected .hold,
.cap.selected .corner,
.cap.selected .lock,
.cap.selected .pos-num {
  color: var(--on-accent);
}

.cap.selected .src-dot {
  background: var(--on-accent);
  opacity: 0.6;
}

/* Top-left corner: the stock position number and the reserved marker share it. */
.corner {
  position: absolute;
  top: 3px;
  left: 5px;
  display: flex;
  align-items: center;
  gap: 3px;
}

.pos-num {
  font-size: 8px;
  font-weight: 700;
  opacity: 0.62;
}

/* Tester mode: the position whose settings the aside is reading out.
 *
 * An amber outline sits outside the box instead of filling it, so a cap can be
 * inspected and closed at the same time and still say both. */
.cap.inspected {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* Tester mode: a switch that has never closed once. Dashed against solid on the
 * same hairline colour is a difference that survives both themes. */
.cap.unreported {
  border-style: dashed;
  background: var(--bg-inset);
}

.cap.unreported .main {
  opacity: 0.62;
}

.cap.unreported .hold,
.cap.unreported .pos-num,
.cap.unreported .src-dot {
  opacity: 0.5;
}

.cap.unreported.selected {
  border-style: solid;
  background: linear-gradient(160deg, #9deab8, var(--accent-deep));
}

/* Staged edit: a thick warm inner ring says "this is not the keyboard's state
 * yet" — distinct from the 1px border a defined cell gets. */
.cap.pending { box-shadow: inset 0 0 0 2px var(--accent); }

.pending-dot {
  position: absolute;
  right: 4px;
  bottom: 3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
}
.src-dot {
  position: absolute;
  left: 4px;
  bottom: 3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--mid);
  opacity: 0.6;
}

.lock {
  font-size: 9px;
  font-weight: 700;
  color: var(--warn);
}

/* Categories stay within one warm hue: plain keys get the keycap fill, the
 * specialised categories sit quieter in the same family. */
.cat-key { background: linear-gradient(160deg, #2c333c, #171b21); }
.cat-mod { background: var(--cap-mod-top); }
.cat-media { background: var(--cap-mod-top); color: var(--cap-text-hold); }
.cat-nav { background: var(--cap-mod-top); color: var(--cap-text-hold); }
.cat-mouse { background: var(--cap-mod-top); color: var(--cap-text-hold); }
.cat-layer { background: var(--cap-layer-top); color: var(--ink); font-weight: 700; }
.cat-holdtap { background: var(--cap-holdtap-top); }
.cat-system { background: var(--cap-system); }
.cat-inherit { background: transparent; color: var(--cap-text-hold); }
.cat-off { background: transparent; color: var(--cap-text-hold); }
.cat-unknown { background: var(--cap-unknown); color: var(--err); }
</style>
