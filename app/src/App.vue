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
import HelpPanel from './components/HelpPanel.vue'
import KeyboardView from './components/KeyboardView.vue'
import LayerTabs from './components/LayerTabs.vue'
import ParamPanel from './components/ParamPanel.vue'
import PanelEditor from './components/PanelEditor.vue'
import { KEYBOARD_NAME } from './proto/zmk.gen.ts'
import { KEEB_EV_CELLS_SET, KEEB_EV_DISCARDED, KEEB_EV_DISPLAY_SAVED, KEEB_EV_DISPLAY_SET, KEEB_EV_LAYER_CHANGED, KEEB_EV_LAYER_STATE, KEEB_EV_SAVED, KEEB_EV_TEXT_SET } from './proto/constants.ts'
import { useDeviceStore } from './stores/device.ts'
import { useDisplayStore } from './stores/display.ts'
import { useKeymapStore } from './stores/keymap.ts'

const device = useDeviceStore()
const keymap = useKeymapStore()
const display = useDisplayStore()
const keyboardName = KEYBOARD_NAME

const pickedPos = ref<number | null>(null)
const view = ref<'keys' | 'panel'>('keys')
const help = ref(false)
const toast = ref('')
const busy = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | undefined
let offEvents: (() => void) | null = null
let offDisplay: (() => void) | null = null
let offToast: (() => void) | null = null

function say(msg: string): void {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 4000)
}

/** Everything that has to happen once a link exists: prove the two token
 * tables agree, then read the layout the keyboard actually has.
 */
async function loadFromKeyboard(): Promise<void> {
  const cap = await device.handshake()

  await keymap.loadAll()
  await display.load()

  say(
    cap.tokenTableMatches
      ? `connected to ${device.label}`
      : 'token table mismatch: writes are refused until the keyboard and this build agree - see the panel',
  )
}

/* The chooser path. Chrome needs a click for this one, which is why it is a
 * button and not something the page does by itself. */
async function connectChooser(all = false): Promise<void> {
  busy.value = true

  try {
    await device.connectBle(all)
    await loadFromKeyboard()
  } catch (err) {
    say(err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}

/* Gesture-free retry against a keyboard this browser is already allowed to
 * reach: the usual answer after the keyboard sleeps or reboots. */
async function connectRetry(): Promise<void> {
  busy.value = true

  try {
    const label = await device.reconnectBle()

    if (!label) {
      say('no saved keyboard reachable - press Connect')
      return
    }

    await loadFromKeyboard()
  } catch (err) {
    say(err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}

async function forgetDevices(): Promise<void> {
  busy.value = true

  try {
    const n = await device.forgetBle()

    say(n ? `forgot ${n} saved device${n === 1 ? '' : 's'} in this browser` : 'this browser has no saved Bluetooth grants')
  } catch (err) {
    say(err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}

/* Forget, then choose again, in one click.
 *
 * Clearing the stale grant and opening the chooser have to happen in the same
 * user gesture: requestDevice() is the one call that needs transient activation,
 * and a separate "forget" click followed by a "connect" click is two gestures -
 * the second one is where a browser that already consumed the activation fails.
 *
 * This is the answer after the keyboard has been reset (BT_CLR, cleared bonds,
 * or a reflash): the keyboard no longer holds a bond with this browser, so the
 * saved entry can no longer complete an encrypted link, and the chooser would
 * keep offering it.
 */
async function repair(): Promise<void> {
  busy.value = true

  try {
    const n = await device.forgetBle()
    await device.connectBle(true)
    await loadFromKeyboard()

    say(n ? `forgot ${n} stale grant${n === 1 ? '' : 's'} and paired again` : 'paired again')
  } catch (err) {
    say(err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  /* The store follows the keyboard; this listener is only for what the user
   * should see. */
  offEvents = keymap.bindEvents()
  offDisplay = display.bindEvents()
  offToast = device.onEvent(toastForEvent)
  window.addEventListener('keydown', onKeydown)

  /* The real keyboard is the only device this UI talks to, and a load tries to
   * restore the session on its own: reconnecting to a device the browser was
   * already granted needs no user gesture. When it cannot - no saved grant, the
   * keyboard asleep, or holding another host's profile - the page shows the
   * Connect card, because the chooser is the one thing that does need a click.
   */
  try {
    const label = await device.reconnectBle()

    if (!label) {
      return
    }

    await loadFromKeyboard()
  } catch (err) {
    say(err instanceof Error ? err.message : String(err))
  }
})

onUnmounted(() => {
  offEvents?.()
  offDisplay?.()
  offToast?.()
  window.removeEventListener('keydown', onKeydown)
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
      say('layout reverted to the keyboard’s saved settings, or to the keymap file if nothing is saved')
      break

    case KEEB_EV_LAYER_CHANGED:
      say('layer list changed on the keyboard')
      break

    case KEEB_EV_DISPLAY_SET:
      say('status panel redrawn on the keyboard')
      break

    case KEEB_EV_TEXT_SET:
      say('text slot written')
      break

    case KEEB_EV_DISPLAY_SAVED:
      say('panel saved to the keyboard')
      break

    default:
      break
  }
}

function onPick(pos: number): void {
  pickedPos.value = pos
}

/* One escape route for both overlays, deepest first. A keyboard configurator is
 * full of modals, and a person who opened one by accident should be able to get
 * out without hunting for the button that closes it.
 */
function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') {
    return
  }

  if (help.value) {
    help.value = false
    return
  }

  if (pickedPos.value !== null) {
    pickedPos.value = null
  }
}

function onSet(binding: { token: number; param1: number; param2: number }): void {
  if (pickedPos.value === null) {
    return
  }

  const r = keymap.setBinding(keymap.editingSlot, pickedPos.value, binding)

  if (!r.ok) {
    say(r.reason ?? 'write refused')
    return
  }

  /* Nothing leaves this page until Push. Selection only stages the edit: a
   * layer is committed as one CELLS_SET that the firmware validates as a whole,
   * so batching every staged cell into that one write is what keeps a partly
   * edited layer from becoming a partly written keyboard.
   */
  say(`staged position ${pickedPos.value} - "Apply changes" (${keymap.dirtyTotal}) writes it${keymap.autosave ? ' and saves it' : ''}`)
}
</script>

<template>
  <div class="app">
    <header>
      <h1>keeb <span>configurator</span></h1>
      <ParamPanel />
    </header>

    <button class="help-btn" title="how the grid, the layers, applying and saving work - and what to do when something looks wrong" @click="help = true">?</button>

    <div v-if="toast" class="toast">{{ toast }}</div>

    <!-- No keyboard, nothing to edit: the page asks for the connection instead
         of drawing a layout no keyboard has ever confirmed. -->
    <section v-if="!device.connected" class="connect">
      <div class="connect-card">
        <h2>No keyboard connected</h2>

        <button class="btn connect" :disabled="busy" @click="connectChooser()">Connect</button>

        <div class="connect-alt">
          <button class="btn link" :disabled="busy" title="reconnect to a keyboard this browser already has permission for - no chooser" @click="connectRetry">retry the saved keyboard</button>
          <button class="btn link" :disabled="busy" title="open the chooser with every BLE device in range, for when the keyboard advertises a name the generated contract does not know" @click="connectChooser(true)">show all devices</button>
          <button class="btn link" :disabled="busy" title="forget this browser's Bluetooth grants and pair again, in one click - do this after the keyboard was reset (BT_CLR, cleared bonds, or a reflash), when a saved entry can no longer complete an encrypted link" @click="repair">re-pair</button>
          <button class="btn link" :disabled="busy" title="revoke this browser's saved Bluetooth grants before re-pairing, or when the chooser offers a device that cannot connect" @click="forgetDevices">forget saved devices</button>
        </div>

        <p class="why">{{ device.statusLine }}</p>
        <p class="why">
          the keyboard has to be advertising: press <b>BT_SEL</b> on an open profile, or
          <b>BT_CLR</b> to clear one. The chooser filters on the advertised name
          (<b>{{ keyboardName }}</b>, from <b>config/keeb.conf</b>) - filtering on "is a HID
          device" is forbidden in Web Bluetooth, because the HID service is blocklisted.
        </p>
      </div>
    </section>

    <template v-else>
      <LayerTabs class="tabs" />

      <div class="views">
        <button :class="['btn', 'view', { on: view === 'keys' }]" @click="view = 'keys'">keymap</button>
        <button :class="['btn', 'view', { on: view === 'panel' }]" title="the status screen on the halves: a table of widgets the keyboard fills from ZMK" @click="view = 'panel'">status panel</button>
      </div>

      <main>
        <KeyboardView v-if="view === 'keys'" :selected-pos="pickedPos" @pick="onPick" />
        <PanelEditor v-else />
      </main>
    </template>

    <KeyPicker
      v-if="pickedPos !== null"
      :pos="pickedPos"
      :reserved="keymap.isReserved(pickedPos)"
      @set="onSet"
      @close="pickedPos = null"
    />

    <HelpPanel :open="help" @close="help = false" />
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

/* The one thing this page cannot do by itself: Web Bluetooth needs a click to
 * open the chooser. So when there is no keyboard, that ask is the biggest thing
 * on the screen instead of a small control in a panel. */
.connect { display: grid; place-items: center; padding: 70px 0 40px; }
.connect-card {
  display: flex; flex-direction: column; align-items: center; gap: 16px;
  max-width: 560px; text-align: center;
}
.connect-card h2 { margin: 0; font-size: 20px; font-weight: 500; color: var(--text-dim); }
.btn {
  border: 1px solid var(--border); border-radius: 8px; background: var(--bg-raised);
  color: var(--text); cursor: pointer; font: inherit; font-size: 13px; padding: 7px 14px;
}
.btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.btn:disabled { opacity: 0.45; cursor: default; }
.btn.connect {
  font-size: 22px; font-weight: 600; letter-spacing: 1px;
  padding: 22px 78px; border-radius: 14px;
  border-color: var(--accent-dim); background: var(--accent); color: #17130c;
}
.btn.connect:hover:not(:disabled) { background: var(--accent-dim); color: #fff; }
.connect-alt { display: flex; gap: 16px; }
.btn.link {
  border: none; background: none; padding: 0; font-size: 12px;
  color: var(--text-faint); text-decoration: underline;
}
.btn.link:hover:not(:disabled) { color: var(--accent); }
.why { margin: 0; max-width: 520px; font-size: 12px; color: var(--text-faint); }
.why b { color: var(--text-dim); }

main { display: flex; flex-direction: column; gap: 12px; }

.views { display: flex; gap: 8px; margin-bottom: 10px; }
.btn.view {
  border: 1px solid var(--border); border-radius: 8px; background: var(--bg-raised);
  color: var(--text-dim); cursor: pointer; font: inherit; font-size: 12px; padding: 6px 14px;
}
.btn.view:hover { border-color: var(--accent); color: var(--accent); }
.btn.view.on { border-color: var(--accent-dim); color: var(--accent); }

/* The legend's content moved into HelpPanel; the button is what stays on the
 * page, placed where a stuck person looks for it rather than under the grid.
 */
.help-btn {
  position: fixed; right: 18px; bottom: 18px; z-index: 40;
  width: 34px; height: 34px; border-radius: 50%;
  border: 1px solid var(--border); background: var(--bg-raised);
  color: var(--text-dim); font: inherit; font-size: 16px; line-height: 1;
  cursor: pointer;
}
.help-btn:hover { border-color: var(--accent); color: var(--accent); }
</style>
