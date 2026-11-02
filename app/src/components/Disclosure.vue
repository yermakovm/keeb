<!--
  A collapsed group.

  The sidebar has controls that matter occasionally and not daily: sticky-key
  variants, `&to` / `&sl`, the diagnostics that explain why a cap looks the way
  it does, the autosave preference. Keeping them visible made the everyday
  controls compete with the occasional ones.

  The `[+]` / `[-]` mark is the whole widget: it says whether the group is open
  in the same language the rest of the page uses, and it is a real button, so it
  is reachable by keyboard and announces its state.
-->
<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  label: string
  /** one line saying what is inside, so a closed group is not a mystery */
  hint?: string
}>()

const open = ref(false)
</script>

<template>
  <div class="disc">
    <button class="head" :aria-expanded="open" @click="open = !open">
      <span class="mark">{{ open ? '[-]' : '[+]' }}</span>
      <span class="label">{{ label }}</span>
      <span v-if="hint" class="hint">{{ hint }}</span>
    </button>

    <div v-if="open" class="body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.disc {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  border: 0;
  border-top: 1px solid var(--line);
  background: transparent;
  color: var(--mid);
  font-family: var(--mono);
  font-size: 12px;
  text-align: left;
  padding: 6px 0;
  cursor: pointer;
}

.head:hover { color: var(--ink); }

.head:hover .mark { color: var(--ink); }

.mark { color: var(--mid); }

.label {
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink);
}

.hint {
  margin-left: auto;
  font-size: 11px;
  text-align: right;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 0 8px;
}
</style>
