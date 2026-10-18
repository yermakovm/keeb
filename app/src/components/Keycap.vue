<script setup lang="ts">
/*
 * One key position on the grid.

 * `pos` is the stock position number — the same number a keeb_cell carries —
 * and the label is derived from the binding's token + params, never stored.
 */
import { computed } from 'vue'

import type { CapDisplay } from '../model/cap.ts'

const props = defineProps<{
  pos: number
  display: CapDisplay
  own: boolean
  reserved: boolean
  /** the grid slot has no key position in the matrix transform */
  unmapped: boolean
  selected: boolean
  dimmed: boolean
  layerLabel: string
}>()

const emit = defineEmits<{ (e: 'pick', pos: number): void }>()

const title = computed(() => {
  const { display } = props

  if (props.unmapped) {
    return `position ${props.pos}: not wired to the matrix`
  }

  if (props.reserved) {
    return `position ${props.pos}: reserved position — the firmware will not rebind it`
  }

  const cap = display.hold ? `${display.main}/${display.hold}` : display.main

  return `${props.layerLabel} · position ${props.pos} · ${cap} · ${display.tokenName}`
})
</script>

<template>
  <button
    class="cap"
    :class="[
      `cat-${display.category}`,
      {
        own,
        inherit: !own && !unmapped && !reserved,
        selected,
        unmapped,
        reserved,
        dimmed,
      },
      display.hold ? 'holdtap' : '',
    ]"
    :disabled="unmapped"
    :title="title"
    @click="emit('pick', pos)"
  >
    <template v-if="!unmapped">
      <span v-if="display.hold" class="hold">{{ display.hold }}</span>
      <span class="main">{{ display.main }}</span>
      <span v-if="!own" class="src-dot" />
      <span v-if="reserved" class="lock" title="reserved">🔒</span>
    </template>
    <template v-else>
      <span class="main">·</span>
    </template>
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
.cap.dimmed { opacity: 0.45; }
.cap.unmapped { border-style: dashed; color: var(--text-faint); background: transparent; }
.cap.reserved { border-style: double; border-width: 3px; }
.cap.selected { box-shadow: 0 0 0 2px var(--accent); }

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
  position: absolute;
  left: 3px;
  top: 2px;
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
