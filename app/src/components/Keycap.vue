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
import { computed } from 'vue'

import type { CapDisplay } from '../model/cap.ts'

const props = withDefaults(
  defineProps<{
    pos: number
    display: CapDisplay
    own: boolean
    reserved: boolean
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
  { unreported: false, variant: 'edit', inspected: false },
)

const emit = defineEmits<{ (e: 'pick', pos: number): void }>()

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
        reserved: !test && reserved,
        pending: !test && pending,
        unreported,
        inspected,
        mod: display.category === 'mod',
        mo: isLayerMove,
      },
      display.hold ? 'holdtap' : '',
    ]"
    :title="title"
    @click="emit('pick', pos)"
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
.cap {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 400;
  display: grid;
  place-items: center;
  padding: 0;
  cursor: pointer;
}

.cap:not(:disabled):hover { border-color: var(--ink); }

.main {
  line-height: 1.05;
  text-align: center;
  word-break: break-word;
}

.hold {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 9px;
  color: var(--mid);
}

/* Modifiers read as dimmer cells, not as coloured ones. */
.cap.mod {
  background: var(--mod);
  color: var(--mid);
}

/* A layer move is emphasised the way the rest of the page emphasises things:
 * weight and a filled ground, not the accent. */
.cap.mo {
  background: var(--soft);
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

/* This layer defines the cell: the border is the stronger grey. The accent is
 * not on the grid at all, so a cap that is defined here cannot be confused with
 * a button that sends something. */
.cap.own { border-color: var(--mid); }

/* Recessive, but still readable: 0.55 put the glyph at 3.9:1 in the light
 * theme. The dimming is the signal, the label still has to be legible. */
.cap.inherit { opacity: 0.62; }

/* A reserved position carries a double hairline and the # in its corner. */
.cap.reserved { border-style: double; border-width: 3px; }

/* Selection inverts the cell: ground and ink swap, which is how a vim visual
 * selection reads. Filling it with the accent made the selected cap look like a
 * different binding rather than the one you are looking at. */
.cap.selected {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--on-ink);
  font-weight: 700;
}

.cap.selected.mod,
.cap.selected.mo {
  background: var(--ink);
  color: var(--on-ink);
}

/* Every mark inside the cap inverts with it, including the ones that normally
 * carry their own colour. */
.cap.selected .hold,
.cap.selected .corner,
.cap.selected .lock,
.cap.selected .pos-num {
  color: var(--on-ink);
}

.cap.selected .src-dot {
  background: var(--on-ink);
  opacity: 0.6;
}

/* Top-left corner: the stock position number and the reserved marker share it. */
.corner {
  position: absolute;
  top: 2px;
  left: 4px;
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
 * It cannot reuse the inversion, because in the tester the inversion already
 * means "this switch is closed right now", and the two facts are independent —
 * you routinely read the settings of a switch you are not holding. An outline
 * sits outside the box instead of filling it, so a cap can be inspected and
 * closed at the same time and still say both. */
.cap.inspected {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}

/* Tester mode: a switch that has never closed once.
 *
 * The mark is the *border style*, not the opacity — .inherit already dims a cap
 * to 0.62 because another layer defines it, and a dead switch must not look
 * like that. Dashed against solid, on the same hairline colour, is a difference
 * that survives both themes and both reasons for being dim. It is also the one
 * state on the grid that is drawn rather than listed: a tester with a table of
 * unreported positions next to it is a tester you have to read. */
.cap.unreported {
  border-style: dashed;
  background: var(--bg-inset);
}

/* Same 0.62 the theme sets for a dimmed control: below it the label stops being
 * legible, and an unreported cap still has to say what it would have been. */
.cap.unreported .main {
  opacity: 0.62;
}

.cap.unreported .hold,
.cap.unreported .pos-num,
.cap.unreported .src-dot {
  opacity: 0.5;
}

/* A reported cap is a solid hairline again, and a closed one is inverted, so
 * the two things you are actually checking stay louder than this. */
.cap.unreported.selected {
  border-style: solid;
  background: var(--ink);
}

/* Staged edit: the local model already shows the new binding, so what has to
 * be visible is that it is not the keyboard's state yet. A thick inner ring is
 * a different mark from the 1px border a defined cell gets. */
.cap.pending { box-shadow: inset 0 0 0 2px var(--ink); }

.pending-dot {
  position: absolute;
  right: 4px;
  bottom: 3px;
  width: 5px;
  height: 5px;
  background: var(--ink);
}

.src-dot {
  position: absolute;
  left: 4px;
  bottom: 3px;
  width: 5px;
  height: 5px;
  background: var(--mid);
  opacity: 0.6;
}

.lock {
  font-size: 9px;
  font-weight: 700;
  color: var(--warn);
}

/* Categories stay within one hue: transparent ground, tinted ink. */
.cat-key { background: transparent; }
.cat-mod { background: var(--mod); }
.cat-media { background: transparent; color: var(--mid); }
.cat-nav { background: transparent; color: var(--mid); }
.cat-mouse { background: transparent; color: var(--mid); }
.cat-layer { background: var(--soft); color: var(--ink); font-weight: 700; }
.cat-holdtap { background: var(--mod); }
.cat-system { background: var(--soft); }
.cat-inherit { background: transparent; color: var(--mid); }
.cat-off { background: transparent; color: var(--mid); }
.cat-unknown { background: var(--soft); color: var(--err); }
</style>
