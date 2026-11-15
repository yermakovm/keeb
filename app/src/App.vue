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

import KeyPalette from './components/KeyPalette.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import SoundPanel from './components/SoundPanel.vue'
import HelpPanel from './components/HelpPanel.vue'
import KeyboardView from './components/KeyboardView.vue'
import LayerRail from './components/LayerRail.vue'
import LogPanel from './components/LogPanel.vue'
import PanelEditor from './components/PanelEditor.vue'
import { describeBinding } from './model/cap.ts'
import { KEYBOARD_NAME } from './proto/zmk.gen.ts'
import type { Binding } from './proto/types.ts'
import {
  KEEB_EV_CELLS_SET,
  KEEB_EV_DISCARDED,
  KEEB_EV_DISPLAY_SAVED,
  KEEB_EV_DISPLAY_SET,
  KEEB_EV_LAYER_CHANGED,
  KEEB_EV_LAYER_STATE,
  KEEB_EV_PEER_DISPLAY_SAVED,
  KEEB_EV_PEER_DISPLAY_SET,
  KEEB_EV_SAVED,
  KEEB_EV_SETTINGS_CHANGED,
  KEEB_EV_TEXT_SET,
  KEEB_DISPLAY_INFO_F_PEER,
} from './proto/constants.ts'
import { useDeviceStore } from './stores/device.ts'
import { useDisplayStore, usePeerDisplayStore } from './stores/display.ts'
import { useKeymapStore } from './stores/keymap.ts'
import { useLogStore } from './stores/log.ts'
import { useSettingsStore } from './stores/settings.ts'
import { useSoundStore } from './stores/sound.ts'
import { useTesterStore } from './stores/tester.ts'

const device = useDeviceStore()
const keymap = useKeymapStore()
const display = useDisplayStore()
const rightPanel = usePeerDisplayStore()
const log = useLogStore()
const settings = useSettingsStore()
const sound = useSoundStore()
const tester = useTesterStore()
const keyboardName = KEYBOARD_NAME

const pickedPos = ref<number | null>(null)
/* Two views of the same board: the editor, and the tester that lights the caps
 * the keyboard reports. The panel editor is not a third view - it is what the
 * bottom section holds when a panel on the board is the thing you clicked. */
const view = ref<'keys' | 'tester' | 'settings' | 'sound' | 'logs'>('keys')
const pickedPanel = ref<string | null>(null)
const help = ref(false)
const toast = ref('')
const busy = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | undefined
let offEvents: (() => void) | null = null
let offDisplay: (() => void) | null = null
let offPeerDisplay: (() => void) | null = null
let offSettings: (() => void) | null = null
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
  await settings.load()
  await sound.load()

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
  offPeerDisplay = rightPanel.bindEvents()
  offSettings = settings.bindEvents()
  offToast = device.onEvent(toastForEvent)
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('pointerdown', onDocPointerDown)

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
  offPeerDisplay?.()
  offSettings?.()
  offToast?.()
  void tester.close()
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', onDocPointerDown)
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

    case KEEB_EV_PEER_DISPLAY_SET:
      say('right panel redrawn on the keyboard')
      break

    case KEEB_EV_PEER_DISPLAY_SAVED:
      say('right panel saved to the keyboard')
      break

    case KEEB_EV_SETTINGS_CHANGED:
      /* The settings store re-reads the record itself, so this only names the
       * change: the values shown afterwards are the keyboard's. */
      say('keyboard settings changed')
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
/** Which panel the picked screen is about. */
const pickedPanelStore = computed(() => (pickedPanel.value === 'right' ? rightPanel : display))

/** DISPLAY_INFO says whether this build can answer for the other half. A split
 * peripheral has no host link of its own, so the central is the one that keeps
 * and relays that table; without the flag screen 2 is a real screen with no
 * configurator channel. */
const rightPanelAvailable = computed(
  () => ((display.info?.flags ?? 0) & KEEB_DISPLAY_INFO_F_PEER) !== 0,
)

function onPickPanel(id: string): void {
  if (id === 'right' && !rightPanelAvailable.value) {
    say('this firmware does not expose the other half\'s panel')
    return
  }

  pickedPanel.value = pickedPanel.value === id ? null : id
  pickedPos.value = null

  if (pickedPanel.value) {
    const panel = pickedPanelStore.value

    if (!panel.loaded) {
      void panel.load()
    }

    say(`${id} - the widget table is below the keyboard`)
  }
}

/* One strip per half, against each half's inner column. Which half this session
 * is attached to is not something the protocol says out loud, so the note says
 * what is actually known: the table that half reported. */
const panelDescriptors = computed(() => {
  if (!device.connected) {
    return []
  }

  const noteFor = (panel: typeof display): string =>
    panel.loaded ? `${panel.widgets.length}/${panel.widgetMax}` : panel.info ? 'not read' : 'no panel'

  return [
    { id: 'left', side: 'left' as const, label: 'screen 1', note: noteFor(display) },
    {
      id: 'right',
      side: 'right' as const,
      label: 'screen 2',
      note: rightPanelAvailable.value ? noteFor(rightPanel) : 'no channel',
    },
  ]
})

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

/* One escape route for the panels that open over the page, deepest first. */
function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') {
    return
  }

  if (settingsOpen.value) {
    settingsOpen.value = false
    return
  }

  if (help.value) {
    help.value = false
    return
  }

  if (pickedPanel.value !== null) {
    pickedPanel.value = null
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

/* Drag-and-drop from a key tile in the dock onto a cap: the dragged binding is
 * left on the window by the tile, and landing on a cap stages it there. */
function onDropPos(pos: number): void {
  const bind = (window as unknown as { __keebDragBinding?: Binding }).__keebDragBinding

  if (!bind) {
    say('nothing to drop')
    return
  }

  pickedPos.value = pos
  const r = keymap.setBinding(keymap.editingSlot, pos, bind)

  if (!r.ok) {
    say(r.reason ?? 'write refused')
    return
  }

  say(`staged position ${pos} - ":apply" (${keymap.dirtyTotal}) writes it${keymap.autosave ? ' and saves it' : ''}`)
}

/* Sections. The board is the page: layers, panels and testing are things you do
 * to it, not separate rooms, so the menu carries the two views of it plus the
 * settings that are not about the board at all. */
const navItems = [
  { id: 'keymap', label: 'Keymap' },
  { id: 'tester', label: 'Tester' },
]

/* Settings is a menu of its own: three pages of things a host can change, each
 * one rendering the same panel with a different slice of the settings table. */
const settingsPages = [
  { id: 'configuration', label: 'Configuration' },
  { id: 'LED', label: 'LED' },
  { id: 'sound', label: 'Sound' },
] as const

type SettingsPageId = (typeof settingsPages)[number]['id']

const activeNav = ref('keymap')
const settingsPage = ref<SettingsPageId>('configuration')
const settingsOpen = ref(false)

/* First click lands on the page you were last on, and leaves the menu open so the
 * other pages are one tap away; once there, the button is a plain toggle. */
function onSettingsClick(): void {
  if (view.value !== 'settings' && view.value !== 'sound') {
    selectSettingsPage(settingsPage.value)
    settingsOpen.value = true
    return
  }

  settingsOpen.value = !settingsOpen.value
}

function selectSettingsPage(id: SettingsPageId): void {
  settingsOpen.value = false
  activeNav.value = 'settings'
  settingsPage.value = id
  view.value = id === 'sound' ? 'sound' : 'settings'
}

function selectSection(id: string): void {
  settingsOpen.value = false
  activeNav.value = id

  if (id === 'tester') {
    view.value = 'tester'
    return
  }

  if (id === 'keymap') {
    view.value = 'keys'
    return
  }

  if (id === 'logs') {
    view.value = 'logs'
  }
}

/* A click outside the settings menu folds it, the same habit as the panels' own
 * dropups. */
function onDocPointerDown(e: MouseEvent): void {
  const t = e.target as Element | null

  if (settingsOpen.value && !t?.closest('.nav-menu')) {
    settingsOpen.value = false
  }
}

/* Key properties panel: the selected position, read back through the same
 * resolver that draws the cap, so the aside and the grid can never disagree. */
const pickedBinding = computed(() =>
  pickedPos.value === null ? null : keymap.resolve(keymap.editingSlot, pickedPos.value)?.binding ?? null,
)

const pickedDisplay = computed(() => describeBinding(pickedBinding.value, keymap.layerName))

/* Dark is the only ground now: the page is a stage, not a place to choose a
 * skin, so the theme logic and the light stylesheet are gone. */
</script>

<template>
  <div class="app">
    <header>
      <div class="head-left">
        <div class="title">
          <h1>{{ keyboardName }}</h1>
          <small>split keyboard · nicenano · ble</small>
        </div>
      </div>

      <nav class="head-center" aria-label="Sections">
        <a
          v-for="item in navItems"
          :key="item.id"
          href="#"
          :class="['nav-link', { on: activeNav === item.id }]"
          @click.prevent="selectSection(item.id)"
        >
          {{ item.label }}
        </a>

        <div class="nav-menu">
          <button
            type="button"
            class="nav-link"
            :class="{ on: activeNav === 'settings' }"
            aria-haspopup="menu"
            :aria-expanded="settingsOpen"
            @click="onSettingsClick"
          >
            Settings <span class="caret" aria-hidden="true">▾</span>
          </button>

          <div v-if="settingsOpen" class="nav-drop" role="menu">
            <button
              v-for="p in settingsPages"
              :key="p.id"
              type="button"
              role="menuitem"
              :class="{ on: settingsPage === p.id && (view === 'settings' || view === 'sound') }"
              @click="selectSettingsPage(p.id)"
            >
              {{ p.label }}
            </button>
          </div>
        </div>

        <button
          type="button"
          class="nav-link log-toggle"
          :class="{ on: activeNav === 'logs' }"
          :aria-pressed="activeNav === 'logs'"
          title="the log page - the transport trace and everything this configurator said"
          @click="selectSection('logs')"
        >
          Log
          <span v-if="log.errors" class="badge">{{ log.errors }}</span>
        </button>
      </nav>

      <div class="head-right">
        <div class="conn" :class="{ off: !device.connected }">
          <span class="dot" />
          <span class="t">{{ device.connected ? 'connected' : 'offline' }}</span>
        </div>

        <button class="btn help-btn" title="how the grid, the layers, applying and saving work - and what to do when something looks wrong" @click="help = true">?</button>
      </div>
    </header>

    <main>
      <!-- The log is a first-class page now, like settings: it owns the whole
           main area, so it hides the keyboard and the connect screen. -->
      <LogPanel v-if="view === 'logs'" />

      <template v-else>
      <!-- No keyboard, nothing to edit: the page asks for the connection instead
           of drawing a layout no keyboard has ever confirmed. -->
      <section v-if="!device.connected" class="connect">
        <div class="connect-card">
          <h2>no keyboard connected</h2>

          <button class="btn connect" :disabled="busy" @click="connectChooser()">Connect</button>

          <div class="connect-alt">
            <button class="btn link" :disabled="busy" title="reconnect to a keyboard this browser already has permission for - no chooser" @click="connectRetry">Retry the saved keyboard</button>
            <button class="btn link" :disabled="busy" title="open the chooser with every BLE device in range" @click="connectChooser(true)">Show all devices</button>
          </div>

          <div class="connect-alt">
            <button class="btn link" :disabled="busy" title="attach the host-side mock keyboard: same codec, same session, same stores - no hardware needed" @click="connectMock">Simulate keyboard</button>
          </div>

          <p class="why">{{ device.statusLine }}</p>
        </div>
      </section>

      <template v-else>
        <!-- Settings owns the whole main area, like the log page: no layer rail,
             no inspector, its own category grid and floating Apply dock. -->
        <SettingsPanel v-if="view === 'settings'" :page="settingsPage === 'sound' ? 'configuration' : settingsPage" />
        <SoundPanel v-else-if="view === 'sound'" />

        <div v-else class="main-row">
          <!-- The layer rail sits in the leftmost column, like the Stage
               reference's slot picker: index in the button, name beneath. -->
          <LayerRail />

          <div class="main-left">
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
                @drop="onDropPos"
              />
            </div>

            <!-- The bottom section is where the thing you clicked gets chosen: a
                 keycode for a key, the widget table for a panel, the event log for
                 the tester. Same surface, three contents, so the board always has
                 one place to look at for what to do next. -->
            <KeyPalette
              v-if="pickedPanel === null && view !== 'tester'"
              :pos="pickedPos"
              :reserved="pickedPos !== null && keymap.isReserved(pickedPos)"
              :busy="busy"
              @set="onSet"
              @apply="applyChanges"
              @revert="keymap.revertEdits()"
              @save="saveToDevice"
              @discard="discardLayout"
            />
            <PanelEditor
              v-else-if="pickedPanel !== null"
              :key="pickedPanel"
              :target="pickedPanel === 'right' ? 1 : 0"
              @close="pickedPanel = null"
            />
          </div>

          <div
            class="main-right"
          >

            <template v-if="pickedPanel === null">
            <!-- The minimalist selected-key card is the same in the keymap and
                 tester views: a lit cap and a short key→value list. The template
                 that followed (KeyReadout + edit panel) is gone, so no view has
                 an old side menu — just this card. -->
            <div class="insp" :class="{ reserved: pickedPos !== null && keymap.isReserved(pickedPos) }">
              <div class="keycap-lite">{{ pickedDisplay.main || '·' }}</div>
              <div class="insp-rows">
                <p><span>tap</span><b>{{ pickedDisplay.main || '—' }}</b></p>
                <p><span>hold</span><b>{{ pickedDisplay.hold || '—' }}</b></p>
                <p><span>layer</span><b>{{ keymap.editingName }}</b></p>
                <p><span>position</span><b>{{ pickedPos === null ? '—' : pickedPos }}</b></p>
              </div>
            </div>
            </template>

            <template v-else>
              <!-- A minimal card for the selected panel, the same shape as the
                   selected-key inspector. The editing itself lives in the
                   sliding editor dock below the board. -->
              <div class="insp">
                <div class="keycap-lite">▥</div>
                <div class="insp-rows">
                  <p><span>panel</span><b>{{ pickedPanel }}</b></p>
                  <p><span>widgets</span><b>{{ pickedPanelStore.widgets.length }} / {{ pickedPanelStore.widgetMax }}</b></p>
                  <p><span>state</span><b>{{ pickedPanelStore.loaded ? 'read' : (pickedPanel === 'right' && !rightPanelAvailable ? 'no channel' : 'not read') }}</b></p>
                </div>
              </div>
            </template>

          </div>
        </div>
      </template>
      </template>
    </main>

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>

    <HelpPanel :open="help" @close="help = false" />
  </div>
</template>

<style scoped>
.app {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  margin: 0;
  padding: 0;
}

/* ---------------------------------------------------------------- header */

/* The chrome floats on the stage: a warm, translucent, softly-blurred bar
 * rather than a slab pinned to the top of the page. */
/* The chrome floats on the stage: a warm, translucent, softly-blurred bar.
 * Three columns (left / nav / right) so the section menu sits genuinely centred
 * at the top, like the Stage reference's top pill. */
/* The chrome floats over the stage instead of owning a row: a warm, translucent,
 * softly-blurred pill centred near the top, the keyboard sitting below it (and
 * scrolling away with the page rather than sticking). */
header {
  position: absolute;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  max-width: calc(100vw - 28px);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 14px;
  padding: 8px 14px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--panel-raised);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.head-left {
  display: flex;
  align-items: center;
  gap: 14px;
  justify-self: start;
  min-width: 0;
}

.head-right {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-self: end;
}

.title {
  line-height: 1.1;
}

.title h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
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
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 8px var(--ok);
}

.conn.off .dot { background: var(--err); box-shadow: 0 0 8px var(--err); }

/* ---------------------------------------------------------------- buttons */

.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 15px;
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease, transform 0.12s ease;
}

.btn:hover:not(:disabled) { border-color: var(--ink); }
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { opacity: 0.55; cursor: default; }

.btn.primary {
  background: linear-gradient(135deg, #9deab8, var(--accent-deep));
  border-color: transparent;
  color: var(--on-accent);
  font-weight: 700;
  box-shadow: 0 0 26px var(--accent-dim);
}

.btn.primary:hover:not(:disabled) { filter: brightness(1.05); border-color: transparent; }

.btn.connect {
  font-size: 15px;
  font-weight: 700;
  padding: 13px 46px;
  border-radius: 14px;
  background: linear-gradient(135deg, #9deab8, var(--accent-deep));
  border-color: transparent;
  color: var(--on-accent);
  box-shadow: 0 0 30px var(--accent-dim);
}

.btn.link {
  border: 0;
  background: none;
  padding: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--mid);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.btn.link:hover:not(:disabled) { color: var(--ink); border-color: transparent; }

/* Icon buttons carry a glyph and stay compact. */
.btn.icon { gap: 6px; border-radius: 12px; padding: 7px 10px; }

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
  border-radius: 8px;
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
  background: var(--bg-inset);
  border: 1px solid var(--line);
  border-radius: var(--r);
  color: var(--ink);
  font: inherit;
  min-width: 0;
}

.layer-select { min-width: 200px; }

/* ---------------------------------------------------------------- nav */

/* The section switcher is the top pill's segmented core, centred. */
nav.head-center {
  justify-self: center;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.3);
}

/* The settings entry is a menu: its own button, and a drop under it. */
.nav-menu { position: relative; }

.nav-menu > .nav-link {
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.nav-menu .caret { font-size: 10px; color: var(--mid); }
.nav-menu > .nav-link.on .caret { color: var(--ink); }

.nav-drop {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 170px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(14, 11, 9, 0.95);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  z-index: 50;
}

.nav-drop button {
  padding: 9px 12px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.nav-drop button:hover { background: rgba(255, 255, 255, 0.08); color: var(--accent); }
.nav-drop button.on { color: var(--accent); font-weight: 600; }

.nav-link {
  display: flex;
  align-items: center;
  padding: 7px 18px;
  border-radius: 10px;
  color: var(--mid);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}

.nav-link:hover { color: var(--ink); }

.nav-link.on {
  background: linear-gradient(160deg, #28313c, #171c23);
  box-shadow: 0 0 0 1px var(--line);
  color: var(--ink);
  font-weight: 600;
}

/* The log toggle lives in the nav now; keep its terminal glyph compact and
 * aligned with the label. */
.nav-link svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
}

.nav-link .badge {
  margin-left: 2px;
}

/* ---------------------------------------------------------------- main */

main {
  flex: 1 1 auto;
  position: relative;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.main-row {
  position: relative;
  display: flex;
  gap: 16px;
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
  /* The rail and sidebar float over the edges, so main-left spans the full
   * width and the keyboard sits on the page's centre axis — the same axis the
   * top nav and the bottom dock use. */
  justify-content: center;
}

/* The inspector and the palettes float as glass panes over the stage, in the
 * same warm translucent family the top pill is. */
.main-right {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 262px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.main-right h2 {
  margin: 0 0 -6px;
  color: var(--mid);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

/* The layer rail floats over the left edge, vertically centred on the
 * keyboard's axis. z-index keeps it above the board: .rail is absolute but
 * comes before .case in the DOM, and .case (position: relative) would
 * otherwise paint over it and swallow the clicks. */
.main-row > .rail {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 5;
}

/* Transient messages: pinned to the bottom-right of the window and out of flow,
 * so a message never shifts the page it is talking about, never scrolls away
 * with it, and never eats a click on what it covers. */
.toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 60;
  max-width: min(420px, calc(100vw - 32px));
  pointer-events: none;
  padding: 8px 14px;
  background: var(--panel-raised);
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 12px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
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
  padding: 40px 30px;
  border: 1px solid var(--line);
  border-radius: 22px;
  background: var(--panel-raised);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.connect-card h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 400;
  color: var(--ink);
}

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
 * pointing at. It is a floating pane so the palette reads as part of the stage. */
.bottom {
  flex: 1 1 auto;
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
  border-radius: 999px;
  color: var(--mid);
  font: inherit;
  font-size: 12px;
  padding: 5px 12px;
  cursor: pointer;
}

.chip:hover:not(:disabled) { color: var(--ink); border-color: var(--ink); }
.chip.on { background: #1e2733; color: var(--ink); border-color: rgba(110, 231, 160, 0.6); font-weight: 700; }
.chip:disabled { opacity: 0.55; cursor: not-allowed; }

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
  font-weight: 500;
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
  border: 1px solid var(--line);
  border-radius: 14px;
  background: linear-gradient(160deg, #9deab8, var(--accent-deep));
  color: var(--on-accent);
  display: grid;
  place-items: center;
  font-size: 22px;
  font-weight: 700;
  flex: none;
  box-shadow: 0 0 26px var(--accent-dim);
}

/* The minimal Stage-style key inspector: a lit cap beside a short key→value
 * list naming tap / hold / layer / position for the selected key. */
.insp {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.25);
  margin: auto 0;
}

.keycap-lite {
  width: 62px;
  height: 62px;
  flex: none;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: linear-gradient(160deg, #2c333c, #171b21);
  border: 1px solid var(--line);
  color: var(--ink);
  font-size: 26px;
  font-weight: 700;
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.insp-reserved .keycap-lite { border-color: var(--warn); }

.insp-rows {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.insp-rows p {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin: 0;
  padding: 5px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.insp-rows p:first-child { border-top: 0; }

.insp-rows span {
  color: var(--mid);
  font-size: 12px;
}

.insp-rows b {
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  text-align: right;
  word-break: break-word;
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

/* The footer is gone — its one action (the log toggle) lives in the nav now. */

/* ---------------------------------------------------------------- responsive */

@media (max-width: 900px) {
  header {
    grid-template-columns: minmax(0, 1fr) auto;
    width: calc(100vw - 28px);
  }

  /* Wrap, not scroll: a scrolling nav would clip the settings drop. */
  nav.head-center {
    grid-column: 1 / -1;
    justify-self: center;
    width: 100%;
    flex-wrap: wrap;
    justify-content: center;
  }

  .nav-link { white-space: nowrap; }

  .main-row {
    flex-direction: column;
  }
  .main-right {
    position: relative;
    width: auto;
  }
  .main-row > .rail {
    position: relative;
    top: auto;
    transform: none;
    align-self: center;
  }

  .conn .t { display: none; }
}

@media (max-width: 600px) {
  header { top: 8px; padding: 8px 10px; }
  .toast { right: 12px; bottom: 12px; }
  main { padding-top: 70px; }
  .btn { padding: 5px 10px; font-size: 12px; }
  .btn.connect { padding: 11px 30px; font-size: 14px; }
}
</style>
