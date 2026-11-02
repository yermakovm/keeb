<script setup lang="ts">
/*
 * Configurator shell - terminal dashboard layout.
 *
 * Three columns (nav | main | aside) under a header and above a status line,
 * drawn the way a vim statusline is drawn: flat rectangles, one accent, and
 * state named in text rather than in colour.
 *
 * The live path is the whole point of this app: every notification the keyboard
 * sends re-reads the affected layer instead of trusting the local copy.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import KeyPicker from './components/KeyPicker.vue'
import KeyPalette from './components/KeyPalette.vue'
import TesterPanel from './components/TesterPanel.vue'
import KeyReadout from './components/KeyReadout.vue'
import BindingEditor from './components/BindingEditor.vue'
import HelpPanel from './components/HelpPanel.vue'
import KeyboardView from './components/KeyboardView.vue'
import LayerTabs from './components/LayerTabs.vue'
import LogPanel from './components/LogPanel.vue'
import PanelEditor from './components/PanelEditor.vue'
import WidgetInspector from './components/WidgetInspector.vue'
import Disclosure from './components/Disclosure.vue'
import { describeBinding } from './model/cap.ts'
import { KEYBOARD_NAME } from './proto/zmk.gen.ts'
import { LAYER_ID_INVALID } from './stores/keymap.ts'
import {
  KEEB_EV_CELLS_SET,
  KEEB_EV_DISCARDED,
  KEEB_EV_DISPLAY_SAVED,
  KEEB_EV_DISPLAY_SET,
  KEEB_EV_LAYER_CHANGED,
  KEEB_EV_LAYER_STATE,
  KEEB_EV_SAVED,
  KEEB_EV_TEXT_SET,
} from './proto/constants.ts'
import { useDeviceStore } from './stores/device.ts'
import { useDisplayStore } from './stores/display.ts'
import { useKeymapStore } from './stores/keymap.ts'
import { useLogStore } from './stores/log.ts'
import { useTesterStore } from './stores/tester.ts'

const device = useDeviceStore()
const keymap = useKeymapStore()
const display = useDisplayStore()
const log = useLogStore()
const tester = useTesterStore()
const keyboardName = KEYBOARD_NAME

const pickedPos = ref<number | null>(null)
/* Two views of the same board: the editor, and the tester that lights the caps
 * the keyboard reports. The panel editor is not a third view - it is what the
 * bottom section holds when a panel on the board is the thing you clicked. */
const view = ref<'keys' | 'tester'>('keys')
const pickedPanel = ref<string | null>(null)
const help = ref(false)
const term = ref(false)
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

  // The toast is the transient one. The log is the one that survives it, and it
  // is the same text the console got.
  log.note(msg)
}

/** Everything that has to happen once a link exists: prove the two token tables
 * agree, then read the layout the keyboard actually has. */
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

/* The mock is the same codec, the same session and the same stores the real path
 * uses - it is how the layout gets checked without a keyboard on the bench. It
 * is offered explicitly rather than auto-attached, so a real session is never
 * silently replaced by a simulated one. */
async function connectMock(): Promise<void> {
  busy.value = true

  try {
    await device.connectMock()
    await loadFromKeyboard()

    say('connected to the simulated keyboard')
  } catch (err) {
    say(err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}

/* Forget, then choose again, in one click: requestDevice() is the one call that
 * needs transient activation, so clearing the stale grant and opening the
 * chooser have to share a gesture. */
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

/** The only path from a staged edit to the keyboard. */
async function applyChanges(): Promise<void> {
  busy.value = true

  try {
    const r = await keymap.commitAll()

    if (!r.ok) {
      say(r.reason ?? 'apply failed')
      return
    }

    say(
      r.saveReason
        ? `applied ${r.applied} cell(s); save failed: ${r.saveReason}`
        : `${r.applied} cell${r.applied === 1 ? '' : 's'} applied${r.saved ? ' and saved' : ''}`,
    )
  } catch (err) {
    say(err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}

async function saveToDevice(): Promise<void> {
  busy.value = true

  try {
    const r = await keymap.save()

    say(r.ok ? 'saved to the keyboard\'s settings' : (r.reason ?? 'save failed'))
  } catch (err) {
    say(err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}

async function discardLayout(): Promise<void> {
  busy.value = true

  try {
    const r = await keymap.discard()

    say(r.ok ? 'reverted to the keyboard\'s saved settings' : (r.reason ?? 'discard failed'))
  } catch (err) {
    say(err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  log.attach()
  offEvents = keymap.bindEvents()
  offDisplay = display.bindEvents()
  offToast = device.onEvent(toastForEvent)
  window.addEventListener('keydown', onKeydown)

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
  log.detach()
  offEvents?.()
  offDisplay?.()
  offToast?.()
  void tester.close()
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
      say('layout reverted to the keyboard\'s saved settings, or to the keymap file if nothing is saved')
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
  pickedPanel.value = null
}

/* The status panels are drawn on the board, so clicking one is how you edit it:
 * the bottom section swaps to the panel table and the aside swaps to its
 * properties. A key and a panel cannot both be selected - the two surfaces can
 * only speak about one thing at a time. */
function onPickPanel(id: string): void {
  pickedPanel.value = pickedPanel.value === id ? null : id
  pickedPos.value = null

  if (pickedPanel.value) {
    if (!display.loaded) {
      void display.load()
    }

    say(`${id} - the widget table is below the keyboard`)
  }
}

/* One strip per half, against each half's inner column. Which half this session
 * is attached to is not something the protocol says out loud, so the note says
 * what is actually known: the table this keyboard reported. */
const panelDescriptors = computed(() => {
  if (!device.connected) {
    return []
  }

  const note = display.loaded
    ? `${display.widgets.length}/${display.widgetMax}`
    : display.info
      ? 'not read'
      : 'no panel'

  return [
    { id: 'left', side: 'left' as const, label: 'screen 1', note },
    { id: 'right', side: 'right' as const, label: 'screen 2', note },
  ]
})

/* The simulated keyboard has no fingers, and the tester board is read-only, so
 * the press comes from the read-out instead of from a cap. Same path as real
 * hardware: notification in, store update, log line. */
function onSimulate(pos: number): void {
  const layer = keymap.editingId

  if (!device.mockKey(pos, true, layer)) {
    say('this keyboard reports its own switches - press a key on it')
    return
  }

  if (typeof window !== 'undefined') {
    window.setTimeout(() => device.mockKey(pos, false, layer), 220)
  }
}

/* Key events are a mode the keyboard is asked to turn on, so they are turned on
 * when the tester opens and off when it closes: a configurator that left the
 * request in place would keep a keyboard streaming keystrokes it was never
 * asked to send. */
watch(view, async (next) => {
  if (next === 'tester') {
    const on = await tester.open()

    say(on ? 'tester open - the keyboard is reporting its switches' : 'tester could not start: ' + (tester.lastError || 'no keyboard'))
    return
  }

  await tester.close()
})

watch(
  () => device.connected,
  (up) => {
    if (!up && view.value === 'tester') {
      void tester.close()
    }
  },
)

/** Unstage the selected cell without touching the rest of the layer. */
async function unstagePicked(): Promise<void> {
  if (pickedPos.value === null) {
    return
  }

  const r = await keymap.revertCell(keymap.editingSlot, pickedPos.value)

  if (!r.ok) {
    say(r.reason ?? 'nothing to unstage')
    return
  }

  say(`unstaged position ${pickedPos.value} - the keyboard's own binding is back`)
}

/* One escape route for the panels that open over the page, deepest first. */
function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') {
    return
  }

  if (help.value) {
    help.value = false
    return
  }

  if (term.value) {
    term.value = false
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

  say(`staged position ${pickedPos.value} - ":apply" (${keymap.dirtyTotal}) writes it${keymap.autosave ? ' and saves it' : ''}`)
}

/* Sections. The board is the page: layers, panels and testing are things you do
 * to it, not separate rooms, so the menu carries the two views of it plus the
 * settings that are not about the board at all. */
const navItems = [
  { id: 'keymap', label: 'keymap' },
  { id: 'tester', label: 'tester' },
  { id: 'settings', label: 'settings' },
]

const activeNav = ref('keymap')

function selectSection(id: string): void {
  activeNav.value = id

  if (id === 'tester') {
    view.value = 'tester'
    return
  }

  if (id === 'keymap') {
    view.value = 'keys'
  }
}

/* The tester has no write in it, so this is the door to the view that does. It
 * carries the selection across: the key you were reading is the key you land on,
 * still selected, in the same layer the read-out was already resolving against.
 */
function editPicked(): void {
  if (pickedPos.value === null) {
    return
  }

  selectSection('keymap')

  say(`position ${pickedPos.value} selected in ${keymap.editingName} - the binding editor is in the aside`)
}

const liveLayers = computed(() => keymap.slots.filter((s) => s.live).map((s) => s.name))

/* Key properties panel: the selected position, read back through the same
 * resolver that draws the cap, so the aside and the grid can never disagree. */
const pickedBinding = computed(() =>
  pickedPos.value === null ? null : keymap.resolve(keymap.editingSlot, pickedPos.value)?.binding ?? null,
)

const pickedDisplay = computed(() => describeBinding(pickedBinding.value, keymap.layerName))

/* Dark and light are the same layout with the ground inverted, so one button
 * flips between them. The choice is kept: a configurator you leave open on a
 * bench should not reset to dark because the page reloaded.
 *
 * Guarded, because this module is also rendered headlessly (npm run smoke), and
 * neither localStorage nor document exists there.
 */
const THEME_KEY = 'keeb.theme'
const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'

const dark = ref(inBrowser ? localStorage.getItem(THEME_KEY) !== 'light' : true)

function applyTheme(): void {
  if (!inBrowser) {
    return
  }

  document.documentElement.dataset.theme = dark.value ? 'dark' : 'light'
}

function toggleTheme(): void {
  dark.value = !dark.value

  if (inBrowser) {
    localStorage.setItem(THEME_KEY, dark.value ? 'dark' : 'light')
  }

  applyTheme()
}

applyTheme()
</script>

<template>
  <div class="app">
    <header>
      <div class="logo" aria-hidden="true">&gt;_</div>
      <div class="title">
        <h1>{{ keyboardName }} configurator</h1>
        <small>split keyboard · nice!view · ble</small>
      </div>
      <div class="spacer" />

      <button class="btn icon" :title="dark ? 'switch to the light ground' : 'switch to the dark ground'" :aria-pressed="dark" @click="toggleTheme">
        <svg v-if="dark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M19.5 4.5l-2 2M6.5 17.5l-2 2" /></svg>
        <span>{{ dark ? 'dark' : 'light' }}</span>
      </button>

      <div class="conn" :class="{ off: !device.connected }">
        <span class="dot" />
        <span class="t">{{ device.connected ? 'connected' : 'offline' }}</span>
      </div>

      <button class="btn help-btn" title="how the grid, the layers, applying and saving work - and what to do when something looks wrong" @click="help = true">?</button>

      <nav aria-label="Sections">
        <a
          v-for="item in navItems"
          :key="item.id"
          href="#"
          :class="['nav-link', { on: activeNav === item.id }]"
          @click.prevent="selectSection(item.id)"
        >
          {{ item.label }}
        </a>
      </nav>
    </header>

    <main>
      <div v-if="toast" class="toast">{{ toast }}</div>

      <!-- No keyboard, nothing to edit: the page asks for the connection instead
           of drawing a layout no keyboard has ever confirmed. -->
      <section v-if="!device.connected" class="connect">
        <div class="connect-card">
          <h2>no keyboard connected</h2>

          <button class="btn connect" :disabled="busy" @click="connectChooser()">Connect</button>

          <div class="connect-alt">
            <button class="btn link" :disabled="busy" title="reconnect to a keyboard this browser already has permission for - no chooser" @click="connectRetry">retry the saved keyboard</button>
            <button class="btn link" :disabled="busy" title="open the chooser with every BLE device in range" @click="connectChooser(true)">show all devices</button>
            <button class="btn link" :disabled="busy" title="forget this browser's Bluetooth grants and pair again, in one click" @click="repair">re-pair</button>
            <button class="btn link" :disabled="busy" title="revoke this browser's saved Bluetooth grants" @click="forgetDevices">forget saved devices</button>
          </div>

          <div class="connect-alt">
            <button class="btn link" :disabled="busy" title="attach the host-side mock keyboard: same codec, same session, same stores - no hardware needed" @click="connectMock">simulate keyboard</button>
          </div>

          <p class="why">{{ device.statusLine }}</p>
          <p class="why">
            the keyboard has to be advertising: press <b>BT_SEL</b> on an open profile, or
            <b>BT_CLR</b> to clear one. The chooser filters on the advertised name
            (<b>{{ keyboardName }}</b>, from <b>config/keeb.conf</b>).
          </p>
        </div>
      </section>

      <template v-else>
        <div class="main-row">
          <div class="main-left">
            <div class="layers">
              <label for="lsel">layer</label>
              <select id="lsel" class="layer-select" :value="keymap.editingSlot" @change="keymap.editingSlot = Number(($event.target as HTMLSelectElement).value)">
                <option v-for="slot in keymap.slots" :key="slot.index" :value="slot.index" :disabled="slot.id === LAYER_ID_INVALID">
                  slot {{ slot.index }} · {{ slot.id === LAYER_ID_INVALID ? 'empty' : slot.name }}
                </option>
              </select>
              <LayerTabs class="tabs" />
              <div class="spacer" />
              <button class="btn primary" :disabled="busy || !keymap.isDirty" title="send one CELLS_SET per dirty layer" @click="applyChanges">apply{{ keymap.dirtyTotal ? ` (${keymap.dirtyTotal})` : '' }}</button>
              <button class="btn" :disabled="busy || !keymap.isDirty" title="throw the staged edits away; the keyboard was never asked to change" @click="keymap.revertEdits()">revert{{ keymap.dirtyTotal ? ` (${keymap.dirtyTotal})` : '' }}</button>
              <button class="btn" :disabled="busy || !device.writable" title="tell the keyboard to persist the layout it has now" @click="saveToDevice">save</button>
              <button class="btn" :disabled="busy || !device.writable" title="reload the layout from the keyboard's saved settings" @click="discardLayout">discard</button>
            </div>

            <div class="board-wrap">
              <KeyboardView
                :mode="view === 'tester' ? 'tester' : 'edit'"
                :selected-pos="pickedPos"
                :held="[...tester.held]"
                :unreported="tester.neverPressed"
                :panels="panelDescriptors"
                :selected-panel="pickedPanel"
                @pick="onPick"
                @pick-panel="onPickPanel"
              />
            </div>

            <!-- The bottom section is where the thing you clicked gets chosen: a
                 keycode for a key, the widget table for a panel, the event log for
                 the tester. Same surface, three contents, so the board always has
                 one place to look at for what to do next. -->
            <section class="bottom">
              <TesterPanel v-if="view === 'tester'" />
              <PanelEditor v-else-if="pickedPanel !== null" />
              <KeyPalette
                v-else
                :pos="pickedPos"
                :reserved="pickedPos !== null && keymap.isReserved(pickedPos)"
                @set="onSet"
              />
            </section>
          </div>

          <div
            class="main-right"
            v-if="device.connected"
            :aria-label="pickedPanel !== null ? '[Properties]' : view === 'tester' ? '[Key read-out]' : '[Key properties]'"
          >
            <h2>{{ pickedPanel !== null ? '[properties]' : view === 'tester' ? '[key read-out]' : '[key properties]' }}</h2>

            <div v-if="pickedPanel !== null" class="row" style="align-items:flex-end">
              <div class="tile">▢</div>
              <label class="l" style="flex:1">
                panel
                <input class="field" readonly :value="pickedPanel" />
              </label>
              <button class="btn link" title="stop editing the panel and go back to the keys" @click="pickedPanel = null">keys</button>
            </div>

            <template v-if="pickedPanel === null">
            <!-- Two variants of the same panel. The tester reads the keyboard, so
                 it gets the read-out; the keymap view writes it, so it gets the
                 editor, the param fields and the token picker. -->
            <KeyReadout
              v-if="view === 'tester'"
              :pos="pickedPos"
              @edit="editPicked"
              @press="onSimulate"
            />

            <template v-else>
            <div class="row" style="align-items:flex-end">
              <div class="tile">{{ pickedDisplay.main || '·' }}</div>
              <label class="l" style="flex:1">
                position
                <input class="field" readonly :value="pickedPos === null ? '-' : pickedPos" />
              </label>
            </div>

            <BindingEditor
              :pos="pickedPos"
              :reserved="pickedPos !== null && keymap.isReserved(pickedPos)"
              @set="onSet"
              @revert="unstagePicked"
            />

            <!-- The bindings this column cannot hold as chips - hold/tap, mouse,
                 bluetooth, output - are edited in this group, the same kind of
                 group the state and the session are. It used to be a popup behind
                 a button: the popup hid the grid the write was for. -->
            <Disclosure label="advanced binding" hint="tokens with arguments">
              <KeyPicker
                v-if="pickedPos !== null"
                :pos="pickedPos"
                :reserved="keymap.isReserved(pickedPos)"
                @set="onSet"
              />
              <p v-else class="why">select a key on the board first</p>
            </Disclosure>
            </template>

            <Disclosure label="state" hint="why this cap looks like this">
              <div class="mods">
                <label><input type="checkbox" disabled :checked="pickedPos !== null && keymap.ownCell(keymap.editingSlot, pickedPos) !== null" title="this layer defines the cell itself" />own</label>
                <label><input type="checkbox" disabled :checked="pickedDisplay.hold !== null" title="hold/tap binding" />hold/tap</label>
                <label><input type="checkbox" disabled :checked="pickedPos !== null && keymap.isPending(keymap.editingSlot, pickedPos)" title="staged, not written yet" />staged</label>
                <label><input type="checkbox" disabled :checked="pickedPos !== null && keymap.isReserved(pickedPos)" title="the firmware refuses writes here" />reserved</label>
                <label><input type="checkbox" disabled :checked="pickedDisplay.category === 'inherit'" title="inherited through &trans from a lower layer" />inherit</label>
                <label><input type="checkbox" disabled :checked="pickedDisplay.category === 'off'" title="&none - this key does nothing" />disabled</label>
              </div>
            </Disclosure>

            <Disclosure label="session" hint="autosave · live layers">
              <label class="l">
                active layers
                <input class="field" readonly :value="liveLayers.length ? liveLayers.join(' + ') : 'none'" />
              </label>
              <label class="l">
                autosave
                <input type="checkbox" :checked="keymap.autosave" :disabled="busy" @change="keymap.setAutosave(($event.target as HTMLInputElement).checked)" />
              </label>
            </Disclosure>
            </template>

            <template v-else>
              <p class="why">{{ display.statusLine }}</p>

              <h3>presets</h3>

              <div class="chips">
                <button
                  v-for="p in display.presets"
                  :key="p.preset"
                  class="chip"
                  :class="{ on: display.preset === p.preset }"
                  :disabled="busy || !display.canEdit"
                  title="replace the whole table with this preset - it is a write, not a preview"
                  @click="display.applyPreset(p.preset)"
                >
                  {{ p.name }}
                </button>

                <span v-if="!display.presets.length" class="why">no presets reported</span>
              </div>

              <Disclosure label="table state" hint="what is staged on the panel">
                <div class="mods">
                  <label><input type="checkbox" disabled :checked="display.loaded" title="the table has been read from the keyboard" />read</label>
                  <label><input type="checkbox" disabled :checked="display.hasLocalEdits" title="the table has edits this host has not sent" />staged</label>
                  <label><input type="checkbox" disabled :checked="display.unsavedWrites" title="written to the keyboard, not yet saved in its settings" />not saved</label>
                  <label><input type="checkbox" disabled :checked="display.problems.length > 0" title="a widget here is outside what this panel can draw" />invalid</label>
                </div>

                <label class="l">
                  widgets
                  <input class="field" readonly :value="`${display.widgets.length} / ${display.widgetMax}`" />
                </label>
              </Disclosure>

              <hr />
              <WidgetInspector />
            </template>

            <a class="more" href="#" @click.prevent="help = true">more options</a>
          </div>
        </div>
      </template>
    </main>



    <footer>
      <template v-if="device.connected">
        <span class="mode" :class="{ edit: keymap.isDirty }">{{ keymap.isDirty ? 'EDIT' : 'NORMAL' }}</span>
        <span class="ok" :class="{ bad: !device.tokenTableMatches }">{{ device.tokenTableMatches ? '[ok]' : '[!]' }}</span>
        <span v-if="keymap.isDirty">{{ keymap.dirtyTotal }} staged</span>
        <span v-else-if="keymap.hasUnsaved">{{ keymap.unsavedWrites }} not saved</span>
        <span v-else-if="keymap.savedAt">saved to the keyboard</span>
        <span v-else>keymap loaded from device</span>
      </template>
      <span v-else>no keyboard</span>

      <div class="spacer" />
      <span v-if="device.info" class="meta">ble  fw {{ device.info.fwVersion }}</span>

      <!-- The log button is the one control that is useful with no keyboard at
           all: a failed pair leaves lines here that the console also got. -->
      <button class="btn icon term-btn" :class="{ on: term }" :aria-pressed="term" title="open the log panel - the transport trace and everything this configurator said" @click="term = !term">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" /><path d="M6 10l3 2-3 2M11 14h6" /></svg>
        <span>log</span>
        <span v-if="log.errors" class="badge">{{ log.errors }}</span>
      </button>
    </footer>

    <LogPanel :open="term" @close="term = false" />

    <HelpPanel :open="help" @close="help = false" />
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "header"
    "main"
    "footer";
  min-height: 100vh;
  margin: 0;
  padding: 0;
}

/* ---------------------------------------------------------------- header */

header {
  grid-area: header;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  flex-wrap: wrap;
}

.logo {
  width: 34px;
  height: 34px;
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 13px;
  background: var(--ink);
  color: var(--on-ink);
  flex: none;
}

.title {
  line-height: 1.1;
}

.title h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}

/* A vim-ish prompt: the path, then a block cursor that blinks. */
.title h1::before {
  content: '~/';
  color: var(--mid);
  margin-right: 6px;
  font-weight: 400;
}

.title h1::after {
  content: '\258B';
  color: var(--ink);
  margin-left: 4px;
  animation: blink 1.1s steps(1) infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .title h1::after { animation: none; }
}

.title small {
  color: var(--mid);
  font-size: 12px;
}

.spacer { flex: 1; }

.conn {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--mid);
  font-size: 12px;
}

.dot {
  width: 8px;
  height: 8px;
  background: var(--ink);
}

.conn.off .dot { background: var(--mid); }

/* ---------------------------------------------------------------- buttons */

.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  background: transparent;
  border: 1px solid var(--line);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

/* Command colon: every action reads like an ex command. It is grey on purpose —
 * the colon is on every button, so in the accent it would be the loudest thing
 * on the page and would say nothing. */
.btn::before {
  content: ':';
  color: var(--mid);
  font-weight: 700;
}

.btn:hover:not(:disabled) { border-color: var(--ink); }
.btn:disabled { opacity: 0.62; cursor: default; }
.btn:disabled::before { color: var(--mid); }

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 700;
}

.btn.primary::before { color: var(--on-accent); }

.btn.connect {
  font-size: 15px;
  font-weight: 700;
  padding: 12px 48px;
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}

.btn.connect::before { color: var(--on-accent); }

.btn.link {
  border: 0;
  padding: 0;
  font-size: 12px;
  color: var(--mid);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.btn.link::before { content: ':'; }
.btn.link:hover:not(:disabled) { color: var(--ink); }

/* Icon buttons carry a glyph, so the command colon is dropped for them. */
.btn.icon { gap: 6px; }
.btn.icon::before { content: none; }

.btn.icon svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
}

.badge {
  min-width: 16px;
  padding: 0 4px;
  background: var(--err);
  color: var(--paper);
  font-weight: 700;
}

.term-btn.on {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--on-ink);
}

select,
.field {
  padding: 3px 8px;
  background: transparent;
  border: 1px solid var(--line);
  color: var(--ink);
  font: inherit;
  min-width: 0;
}

.layer-select { min-width: 200px; }

/* ---------------------------------------------------------------- nav */

nav {
  display: flex;
  align-items: center;
  gap: 2px;
  counter-reset: nav;
}

.nav-link {
  counter-increment: nav;
  display: flex;
  align-items: center;
  padding: 4px 12px;
  color: var(--ink);
  text-decoration: none;
  font-size: 13px;
  white-space: nowrap;
}

.nav-link::before {
  content: counter(nav);
  color: var(--mid);
  display: inline-block;
  width: 2.4ch;
}

.nav-link:hover { background: var(--mod); }

.nav-link.on {
  background: var(--mod);
  box-shadow: inset 0 -3px 0 var(--accent);
  font-weight: 700;
}

.nav-link.on::before { color: inherit; opacity: 0.6; }

/* ---------------------------------------------------------------- main */

main {
  grid-area: main;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  /* The 1fr row of .app is the viewport height minus header and footer; main
   * has to be able to shrink to it, not just be told to fill it, or its own
   * content decides how tall the page is. */
  min-height: 0;
  overflow: auto;
}

.main-row {
  display: flex;
  gap: 16px;
  /* Stretch, not flex-start: the aside and the column under the board both run
   * to the bottom of the page instead of stopping where their content stops. */
  align-items: stretch;
  flex: 1 1 auto;
  min-height: 0;
}

.main-left {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.main-right {
  position: relative;
  width: 260px;
  flex-shrink: 0;
  align-self: stretch;
  background: var(--panel);
  border: 1px solid var(--line);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.main-right h2 {
  position: absolute;
  top: -10px;
  left: 14px;
  margin: 0;
  padding: 0 6px;
  background: var(--panel);
  color: var(--mid);
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0.05em;
}

.toast {
  padding: 6px 12px;
  background: var(--panel);
  border: 1px solid var(--line);
  box-shadow: inset 3px 0 0 var(--ink);
  font-size: 12px;
  color: var(--ink);
}

.connect {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 20px 0;
}

.connect-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  max-width: 560px;
  text-align: center;
}

.connect-card h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 400;
  color: var(--mid);
}

.connect-card h2::before { content: '[ '; color: var(--mid); }
.connect-card h2::after { content: ' ]'; color: var(--mid); }

.connect-alt { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }

.why {
  margin: 0;
  max-width: 520px;
  font-size: 12px;
  color: var(--mid);
}

.why b { color: var(--ink); }

.layers {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.layers label { color: var(--mid); font-size: 12px; }

.board-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

/* The bottom section: one slot under the board that holds whatever the board is
 * pointing at. It is wide because a keycode menu and a widget table are wide
 * things, and the aside is narrow because a property is a narrow thing.
 * It takes the height the board did not use, so the page ends at the fold
 * instead of leaving a strip of empty ground below the panel. */
.bottom {
  flex: 1 1 auto;
  /* A floor, not zero: on a short window the palette is the first thing to be
   * squeezed, and a 40px-tall palette is not a palette. */
  min-height: 160px;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.bottom > * {
  flex: 1 1 auto;
  min-height: 0;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--mid);
  font: inherit;
  font-size: 12px;
  padding: 4px 8px;
  cursor: pointer;
}

.chip:hover:not(:disabled) { color: var(--ink); border-color: var(--ink); }
.chip.on { background: var(--mod); color: var(--ink); border-color: var(--ink); font-weight: 700; }
.chip:disabled { opacity: 0.62; cursor: not-allowed; }

h3 {
  margin: 8px 0 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--mid);
}

.main-right h3 {
  font-size: 12px;
  margin: 0 0 8px;
  color: var(--mid);
  font-weight: 400;
}

.l {
  display: grid;
  gap: 5px;
  color: var(--mid);
  font-size: 12px;
}

.l > * { color: var(--ink); }

.row { display: flex; gap: 8px; }
.row > *:first-child { flex: 1; }

.tile {
  width: 56px;
  height: 56px;
  border: 1px solid var(--ink);
  background: var(--ink);
  color: var(--on-ink);
  display: grid;
  place-items: center;
  font-size: 22px;
  font-weight: 700;
  flex: none;
}

.mods {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 14px;
}

.mods label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ink);
}

hr {
  border: 0;
  border-top: 1px dashed var(--soft);
  margin: 0;
}

.field { width: 100%; }

.more {
  color: var(--ink);
  font-size: 12px;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.more:hover { color: var(--mid); }

/* ---------------------------------------------------------------- footer */

footer {
  grid-area: footer;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  min-height: 30px;
  border-top: 1px solid var(--line);
  background: var(--panel);
  font-size: 12px;
  color: var(--mid);
}

/* The mode indicator is the one filled block in the chrome, and it is the only
 * place the accent answers a question: filled grey means the page matches the
 * keyboard, filled accent means something you staged has not been sent. */
.mode {
  align-self: stretch;
  display: flex;
  align-items: center;
  padding: 0 14px;
  background: var(--ink);
  color: var(--on-ink);
  font-weight: 700;
}

.mode.edit {
  background: var(--accent);
  color: var(--on-accent);
}

.ok { color: var(--ok); }
.ok.bad { color: var(--err); }

.meta { color: var(--mid); white-space: pre; }

footer .btn.primary { padding: 2px 12px; }

/* ---------------------------------------------------------------- responsive */

@media (max-width: 900px) {
  .app {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'header'
      'main'
      'footer';
  }

  nav {
    order: 1;
    width: 100%;
    overflow-x: auto;
    border-bottom: 1px solid var(--line);
    padding: 6px 0;
  }

  .nav-link { white-space: nowrap; }

  .main-row {
    flex-direction: column;
  }
  .main-right {
    width: auto;
    border: 1px solid var(--line);
    border-top: 0;
  }

  .conn .t { display: none; }
}

@media (max-width: 600px) {
  header { padding: 8px 12px; }
  main { padding: 12px; }
  .btn { padding: 3px 9px; font-size: 12px; }
  .btn.connect { padding: 10px 32px; font-size: 14px; }
  footer { flex-wrap: wrap; padding: 6px 12px; }
}
</style>
