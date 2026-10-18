<script setup lang="ts">
/*
 * Configurator shell.
 *
 * The live path is the whole point of this app: every notification the
 * keyboard sends (layer state while someone types, a cells-set that landed,
 * a save, a discard from the revert chord) re-reads the affected layer instead
 * of trusting the local copy, because the keyboard also changes on its own.
 */
import { onMounted, onUnmounted, ref } from 'vue'

import KeyPicker from './components/KeyPicker.vue'
import KeyboardView from './components/KeyboardView.vue'
import LayerTabs from './components/LayerTabs.vue'
import ParamPanel from './components/ParamPanel.vue'
import { KEEB_EV_CELLS_SET, KEEB_EV_DISCARDED, KEEB_EV_LAYER_CHANGED, KEEB_EV_LAYER_STATE, KEEB_EV_SAVED } from './proto/constants.ts'
import { useDeviceStore } from './stores/device.ts'
import { useKeymapStore } from './stores/keymap.ts'

const device = useDeviceStore()
const keymap = useKeymapStore()

const pickedPos = ref<number | null>(null)
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined
let offEvents: (() => void) | null = null
let offToast: (() => void) | null = null

function say(msg: string): void {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 4000)
}

onMounted(async () => {
  /* The store follows the keyboard; this listener is only for what the user
   * should see. */
  offEvents = keymap.bindEvents()
  offToast = device.onEvent(toastForEvent)

  /* The mock is the default device so the UI is usable (and testable) without
   * hardware. "Bluetooth…" in the panel is the real keyboard. */
  try {
    await device.connectMock()
    const cap = await device.handshake()
    await keymap.loadAll()

    say(
      cap.tokenTableMatches
        ? `connected to ${device.label}`
        : 'token table mismatch: regenerate the contract table before writing',
    )
  } catch (err) {
    say(err instanceof Error ? err.message : String(err))
  }
})

onUnmounted(() => {
  offEvents?.()
  offToast?.()
  clearTimeout(toastTimer)
})

function toastForEvent(e: { event: number; seq: number; data: Uint8Array }): void {
  switch (e.event) {
    case KEEB_EV_LAYER_STATE: {
      const ids = keymap.slots.filter((s) => s.live).map((s) => s.name)

      say(`keyboard layer: ${ids.length ? ids.join(' + ') : 'none'}`)
      break
    }

    case KEEB_EV_CELLS_SET: {
      const count = (e.data[1] ?? 0) | ((e.data[2] ?? 0) << 8)

      say(`${count} cells rebound on layer ${keymap.layerName(e.data[0] ?? 0)}`)
      break
    }

    case KEEB_EV_SAVED:
      say('layout saved to the keyboard')
      break

    case KEEB_EV_DISCARDED:
      say('layout reverted to the keymap file')
      break

    case KEEB_EV_LAYER_CHANGED:
      say('layer list changed on the keyboard')
      break

    default:
      break
  }
}

function onPick(pos: number): void {
  pickedPos.value = pos
}

async function onSet(binding: { token: number; param1: number; param2: number }): Promise<void> {
  if (pickedPos.value === null) {
    return
  }

  const r = keymap.setBinding(keymap.editingSlot, pickedPos.value, binding)

  if (!r.ok) {
    say(r.reason ?? 'write refused')
    return
  }

  const c = keymap.commitLayer(keymap.editingSlot)

  c.then((res) => {
    if (!res.ok) {
      say(res.reason ?? 'push failed')
    }
  })
}
</script>

<template>
  <div class="app">
    <header>
      <h1>keeb <span>configurator</span></h1>
      <ParamPanel />
    </header>

    <div v-if="toast" class="toast">{{ toast }}</div>

    <LayerTabs class="tabs" />

    <main>
      <KeyboardView :selected-pos="pickedPos" @pick="onPick" />

      <aside class="legend">
        <div><b>Ring</b> = this layer defines the cell</div>
        <div><b>Dimmed + dot</b> = inherited through &trans</div>
        <div><b>Double border 🔒</b> = reserved position, never writable</div>
        <div><b>Dashed</b> = grid slot with no key position</div>
        <div>Diagonal caps = hold/tap (hold top-right, tap bottom-left)</div>
        <div><b>●</b> on a tab = that layer is live on the keyboard right now</div>
      </aside>
    </main>

    <KeyPicker
      v-if="pickedPos !== null"
      :pos="pickedPos"
      :reserved="keymap.isReserved(pickedPos)"
      @set="onSet"
      @close="pickedPos = null"
    />
  </div>
</template>

<style scoped>
.app { max-width: 1240px; margin: 0 auto; padding: 18px 24px 40px; }

header {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 20px; flex-wrap: wrap; margin-bottom: 14px;
}
h1 { margin: 0; font-size: 18px; letter-spacing: 1px; }
h1 span { color: var(--text-dim); font-weight: 400; }

.toast {
  padding: 6px 12px; margin-bottom: 10px;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg-raised); color: var(--text-dim); font-size: 12px;
}

.tabs { margin-bottom: 14px; }

main { display: flex; flex-direction: column; gap: 12px; }

.legend {
  display: flex; gap: 18px; flex-wrap: wrap;
  color: var(--text-faint); font-size: 11.5px;
}
.legend b { color: var(--text-dim); font-weight: 600; }
</style>
