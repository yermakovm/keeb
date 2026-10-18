<script setup>
import { computed } from 'vue'
import { keyLabel, bindingCategory } from '../data/keycodes.js'

const props = defineProps({
  /** cell addressing (declared so they don't fall through as DOM attrs) */
  k: { type: String, default: '' },
  side: { type: String, default: '' },
  row: { type: Number, default: -1 },
  col: { type: Number, default: -1 },
  /** resolved binding (may be null) */
  binding: { type: Object, default: null },
  /** true when the edited layer defines this cell itself */
  own: { type: Boolean, default: false },
  wired: { type: Boolean, default: true },
  dimmed: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  layerName: { type: String, default: '' },
})

const emit = defineEmits(['pick'])

const category = computed(() =>
  props.wired ? bindingCategory(props.binding) : 'unwired'
)

/** Label(s) shown on the cap. Hold/tap kinds render a diagonal split. */
const cap = computed(() => {
  const b = props.binding
  if (!b) return { main: '—', hold: null }
  switch (b.kind) {
    case 'key': return { main: keyLabel(b.code), hold: null }
    case 'mo': return { main: 'MO', hold: b.layerName ?? b.layer }
    case 'to': return { main: 'TO', hold: b.layerName ?? b.layer }
    case 'lt': return { main: keyLabel(b.tap), hold: b.layerName ?? b.layer }
    case 'hml': case 'hmr': return { main: keyLabel(b.tap), hold: keyLabel(b.hold) }
    case 'mmv': case 'msc': case 'mkp': return { main: keyLabel(b.code), hold: null }
    default: return { main: '?'.repeat(3), hold: null }
  }
})
</script>

<template>
  <button
    class="cap"
    :class="[
      `cat-${category}`,
      { own, inherit: !own && wired, selected, unwired: !wired, dimmed },
      cap.hold ? 'holdtap' : '',
    ]"
    :disabled="!wired"
    :title="layerName ? `${layerName} · ${cap.main}${cap.hold ? '/' + cap.hold : ''}` : ''"
    @click="$emit('pick')"
  >
    <template v-if="wired">
      <span v-if="cap.hold" class="hold">{{ cap.hold }}</span>
      <span class="main">{{ cap.main }}</span>
      <span v-if="!own" class="src-dot" />
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
  background: linear-gradient(160deg, var(--cap-key-top) 0%, var(--cap-key) 100%);
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.45);
  user-select: none;
}

.cap:hover:enabled { filter: brightness(1.25); }
.cap:active:enabled { transform: translateY(2px); box-shadow: 0 1px 0 rgba(0,0,0,0.45); }

.cat-mod { background: linear-gradient(160deg, var(--cap-mod-top), var(--cap-mod)); }
.cat-layer { background: linear-gradient(160deg, var(--cap-layer-top), var(--cap-layer)); }
.cat-holdtap { background: linear-gradient(160deg, var(--cap-holdtap-top), var(--cap-holdtap)); }
.cat-media { background: linear-gradient(160deg, var(--cap-media-top), var(--cap-media)); }
.cat-mouse { background: linear-gradient(160deg, var(--cap-mouse-top), var(--cap-mouse)); }
.cat-nav { background: linear-gradient(160deg, var(--cap-nav-top), var(--cap-nav)); }

/* Diagonal hold/tap split, Oryx-style: hold label top-right, tap bottom-left. */
.cap.holdtap { background: linear-gradient(
    135deg,
    var(--cap-holdtap-top) 0%, var(--cap-holdtap-top) 48%,
    #26262c 48%, #26262c 52%,
    var(--cap-key-top) 52%, var(--cap-key) 100%); }
.cap.holdtap.cat-layer { background: linear-gradient(
    135deg,
    var(--cap-layer-top) 0%, var(--cap-layer-top) 48%,
    #26262c 48%, #26262c 52%,
    var(--cap-key-top) 52%, var(--cap-key) 100%); }

.hold {
  position: absolute;
  top: 3px;
  right: 5px;
  font-size: 8px;
  color: var(--cap-text-hold);
  opacity: 0.9;
}
.main { position: relative; z-index: 1; }

/* inherited (resolved from a lower layer) — dimmed */
.cap.inherit { filter: brightness(0.55) saturate(0.7); }
/* unwired matrix cell */
.cap.unwired {
  background: var(--cap-unwired);
  border-style: dashed;
  border-color: var(--border-soft);
  color: var(--text-faint);
  cursor: default;
}
/* own override on edited layer gets an accent ring */
.cap.own { border-color: var(--accent-dim); }
.cap.own::after {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: 5px;
  border: 1px solid rgba(224, 161, 88, 0.35);
  pointer-events: none;
}
/* small dot marking inherited caps */
.src-dot {
  position: absolute;
  bottom: 3px;
  right: 4px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
}
.cap.selected {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  filter: brightness(1.15);
}
.cap.dimmed { opacity: 0.45; }
</style>
