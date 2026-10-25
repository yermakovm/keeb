<script setup lang="ts">
/*
 * One key position on the grid.

 * `pos` is the stock position number — the same number a keeb_cell carries —
 * and the label is derived from the binding's token + params, never stored.
 *
 * Where the cap sits is not this component's business: KeyboardView places it,
 * straight from the matrix transform's map order.
 */
import { computed } from 'vue'

import type { CapDisplay } from '../model/cap.ts'

const props = defineProps<{
  pos: number
  display: CapDisplay
  own: boolean
  reserved: boolean
  selected: boolean
  /** this cell has a staged edit that has not been written to the keyboard */
  pending: boolean
  /** print the stock position number, for matching a cap to a CELLS record */
  showPos: boolean
  layerLabel: string
}>()

const emit = defineEmits<{ (e: 'pick', pos: number): void }>()

const title = computed(() => {
  const { display } = props

  if (props.reserved) {
    return `position ${props.pos}: reserved position — the firmware will not rebind it`
  }

  const cap = display.hold ? `${display.main}/${display.hold}` : display.main
  const staged = props.pending ? ' · staged, not written yet' : ''

  return `${props.layerLabel} · position ${props.pos} · ${cap} · ${display.tokenName}${staged}`
})
</script>

<template>
  <button
    class="cap"
    :class="[
      `cat-${display.category}`,
      {
        own,
        inherit: !own && !reserved,
        selected,
        reserved,
        pending,
      },
      display.hold ? 'holdtap' : '',
    ]"
    :title="title"
    @click="emit('pick', pos)"
  >
    <span v-if="showPos || reserved" class="corner">
      <span v-if="showPos" class="pos-num">{{ pos }}</span>
      <span v-if="reserved" class="lock" title="reserved">🔒</span>
    </span>

    <span v-if="display.hold" class="hold">{{ display.hold }}</span>
    <span class="main">{{ display.main }}</span>
    <span v-if="!own" class="src-dot" />
    <span v-if="pending" class="pending-dot" title="staged edit - Push writes it" />
  </button>
</template>

<style scoped>
.cap {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 7px;
  border: 1px solid var(--border);
  color: var(--cap-text);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.06s ease, filter 0.12s ease, box-shadow 0.12s ease;
}

.cap:not(:disabled):hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}

.main { line-height: 1.1; }

.hold {
  position: absolute;
  top: 3px;
  right: 4px;
  font-size: 9px;
  opacity: 0.75;
}

/* Diagonal split for hold/tap caps: hold top-right, tap bottom-left. */
.cap.holdtap {
  background:
    linear-gradient(
      to top right,
      transparent 0 calc(50% - 1px),
      var(--border-soft) calc(50% - 1px) calc(50% + 1px),
      transparent calc(50% + 1px) 100%
    );
}

.cap.holdtap .main { align-self: flex-end; margin-left: -8%; margin-bottom: 4%; }

.cap.own { border-color: var(--layer-color, var(--accent)); border-width: 2px; }
.cap.inherit { opacity: 0.72; }
.cap.reserved { border-style: double; border-width: 3px; }
.cap.selected { box-shadow: 0 0 0 2px var(--accent); }

/* Top-left corner: the stock position number and the reserved lock share it. */
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
  opacity: 0.55;
}

/* Staged edit: the local model already shows the new binding, so what has to
 * be visible is that it is not the keyboard's state yet. */
.cap.pending { box-shadow: 0 0 0 1px var(--ok); }

.pending-dot {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ok);
}

.src-dot {
  position: absolute;
  left: 4px;
  bottom: 4px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-faint);
  opacity: 0.6;
}

.lock {
  font-size: 8px;
  opacity: 0.7;
}

.cat-key { background: var(--cap-key); }
.cat-mod { background: var(--cap-mod); }
.cat-media { background: var(--cap-media); }
.cat-nav { background: var(--cap-nav); }
.cat-mouse { background: var(--cap-mouse); }
.cat-layer { background: var(--cap-layer); }
.cat-holdtap { background: var(--cap-holdtap); }
.cat-system { background: var(--cap-system); }
.cat-inherit { background: var(--cap-inherit); color: var(--text-faint); }
.cat-off { background: var(--cap-off); color: var(--text-faint); }
.cat-unknown { background: var(--cap-unknown); color: var(--text); }
</style>
