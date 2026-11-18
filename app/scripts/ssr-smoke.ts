/*
 * Headless render smoke test.
 *
 * Builds the real components through Vite's SSR pipeline and renders them
 * against the simulated keyboard. It is not a browser test — it is the cheapest
 * way to prove the templates, the generated grid and the stores line up
 * (a typo in a template is otherwise only visible by eye).
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { renderToString } from '@vue/server-renderer'

import App from '../src/App.vue'
import KeyPicker from '../src/components/KeyPicker.vue'
import KeyReadout from '../src/components/KeyReadout.vue'
import PanelEditor from '../src/components/PanelEditor.vue'
import SettingsPanel from '../src/components/SettingsPanel.vue'
import SoundPanel from '../src/components/SoundPanel.vue'
import { useDeviceStore } from '../src/stores/device.ts'
import { useDisplayStore } from '../src/stores/display.ts'
import { useKeymapStore } from '../src/stores/keymap.ts'
import { useSettingsStore } from '../src/stores/settings.ts'
import { useSoundStore } from '../src/stores/sound.ts'
import { KEYCODES, KEY_COUNT, TOKENS } from '../src/proto/zmk.gen.ts'

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)

const device = useDeviceStore()
const keymap = useKeymapStore()
const display = useDisplayStore()
const settings = useSettingsStore()

const fail = (msg: string): never => {
  console.error(`FAIL: ${msg}`)
  process.exitCode = 1
}

keymap.bindEvents()
await device.connectMock()

const cap = await device.handshake()

if (!cap.tokenTableMatches) {
  fail('token table hash mismatch between the UI and the simulated firmware')
}

await keymap.loadAll()

if (keymap.slots.length !== 6) {
  fail(`expected 6 layers, got ${keymap.slots.length}`)
}

const kp = TOKENS.find((t) => t.label === 'kp')!.id

/* Every cap carries "position N" in its title, in DOM order.
 *
 * The transform's map order is the physical order of the keys - the left half
 * listed outer edge to split gap, the right half listed gap to outer edge - so
 * drawing each half in that order makes the caps appear as 0,1,2,...,59. A view
 * that sorted each half by column number flips the whole right hand: the outer
 * top-right corner (position 11) would sit next to the split.
 */
function capsDrawnInMapOrder(rendered: string): boolean {
  const drawn = [...rendered.matchAll(/position (\d+)/g)].map((m) => Number(m[1]))
  const expected = Array.from({ length: KEY_COUNT }, (_, pos) => pos)

  if (drawn.length !== expected.length) {
    console.log(`     caps drawn ${drawn.length}, the transform maps ${expected.length}`)

    return false
  }

  const bad = expected.findIndex((p, i) => drawn[i] !== p)

  if (bad >= 0) {
    console.log(`     first mismatch at draw #${bad}: expected position ${expected[bad]}, got ${drawn[bad]}`)

    return false
  }

  return true
}

keymap.setBinding(0, 12, { token: kp, param1: KEYCODES.A, param2: 0 })

const commit = await keymap.commitLayer(0)

if (!commit.ok) {
  fail(`commit failed: ${commit.reason}`)
}

await display.load()

if (display.widgets.length !== 18) {
  fail(`the simulated panel has ${display.widgets.length} widgets, the firmware preset has 18`)
}

await settings.load()

if (!settings.loaded) {
  fail(`the simulated keyboard exposes the settings channel, but the store did not read it: ${settings.lastError}`)
}

const html = await renderToString(app)

/* The sidebar alone: the grid legitimately spells out tokens like &to and
 * caps_word in the caps it draws, so a claim about what the sidebar hides has
 * to be measured on the sidebar. It is the right column of the main area, so the
 * slice runs from that column to the end of <main>. */
const asideStart = html.indexOf('class="main-right"')
const aside = asideStart < 0 ? '' : html.slice(asideStart, html.indexOf('</main>', asideStart))

/* The menu alone, for the same reason: the words it must not contain appear
 * elsewhere on the page legitimately. */
const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'))

/* The text labels the nav actually prints, so a check about copy reads the copy
 * and not the markup around it. Symbols (the ▾ caret, the log badge number) are
 * skipped: they have no first letter to capitalise. */
function navLabels(): string[] {
  return [...nav.matchAll(/>\s*([A-Za-z][\w .·-]*?)\s*</g)].map((m) => m[1])
}

/* The dock under the board, sliced for the same reason as the sidebar. */
const dockStart = html.indexOf('class="dock"')
const dock = dockStart < 0 ? '' : html.slice(dockStart, html.indexOf('</section>', dockStart))

const panel = await renderToString(createApp(PanelEditor).use(pinia))

const picker = await renderToString(
  createApp(KeyPicker, { pos: 12, reserved: false }).use(pinia),
)

/* The tester's variant of the same properties: it reads the keyboard, so it
 * must not carry an input or a write. */
const readout = await renderToString(createApp(KeyReadout, { pos: 12 }).use(pinia))

const settingsView = await renderToString(createApp(SettingsPanel, { page: 'configuration' }).use(pinia))
const ledView = await renderToString(createApp(SettingsPanel, { page: 'LED' }).use(pinia))

await useSoundStore().load()

const soundView = await renderToString(createApp(SoundPanel).use(pinia))

const checks: Array<[string, boolean]> = [
  ['keyboard grid', html.includes('class="row"')],
  ['60 positions', (html.match(/class="cap/g) ?? []).length === 60],
  ['grid slots with no switch render as placeholders', (html.match(/class="slot"/g) ?? []).length === 12],
  /* The cap order IS the transform: the right half runs from the split gap out
   * to its outer corner, so position 11 lands last, not first. A view that
   * sorted each half by column number would flip the whole right hand. */
  ['caps render in matrix-transform map order', capsDrawnInMapOrder(html)],
  /* Layers are a rail beside the board now, one slot button per layer, with the
   * rename and the move controls hanging off the slot being edited. */
  ['6 layer slots in the rail', (html.match(/class="rail-btn"/g) ?? []).length === 6],
  /* The arrangement is a preset, and the case is drawn as an outline around both
   * halves. The default preset is the board itself, so it is the one the page
   * draws. */
  ['case outline drawn', html.includes('class="case"') && html.includes('data-layout="cosmotyl"')],
  /* The log toggle moved from a footer button into the top nav, next to Help. */
  ['log panel reachable from the nav', html.includes('log-toggle')],
  /* The right column is an inspector of the selected cap: tap, hold, layer,
   * position, and nothing that writes. The writes are in the dock. */
  [
    'the sidebar inspects, it does not write',
    aside.includes('class="insp"')
      && ['tap', 'hold', 'layer', 'position'].every((row) => aside.includes(`>${row}<`))
      && !aside.includes('<input')
      && !aside.includes('<button'),
  ],
  /* Apply is always on the bar; revert / save / discard sit behind the ⋯ next to
   * it. Both are drawn before anything is clicked. */
  [
    'the dock carries the write actions',
    dock.includes('go-apply') && dock.includes('revert · save · discard'),
  ],
  /* The picker is the dock itself: a search, then a category step, no group that
   * has to be opened first and nothing fixed over the page. */
  [
    'the picker is the dock, not a sidebar group or an overlay',
    dock.includes('class="cats"') && !aside.includes('class="cat"') && !html.includes('class="overlay"'),
  ],
  /* Layer and behavior tokens are picked in the dock, so they never appear in
   * the inspector column either. */
  [
    'behavior tokens stay out of the inspector',
    ['&amp;mo', '&amp;to', '&amp;tog', '&amp;sl', '&amp;lt'].every((s) => !aside.includes(s)),
  ],
  /* Categories on the bar, not tabs: four named on the surface, the rest named
   * inside More so the whole token space is visible before anything is opened. */
  [
    'the dock names every category',
    ['Letters', 'Symbols', 'Modifiers', 'Navigation'].every((c) => dock.includes(`>${c}<`))
      && dock.includes('Function, Media, Layers, Dual, System, Mouse'),
  ],
  /* The board is the page: the things you do to it are views of it, not rooms.
   * A tester is a second view of the same board; the panels and the layer list
   * are edited where they are drawn. */
  [
    'the menu holds the board, not a room per feature',
    ['Keymap', 'Tester', 'Settings'].every((s) => nav.includes(s))
      && ['displays', 'macros', 'layers'].every((s) => !nav.includes(`>${s}<`)),
  ],
  /* Menu and page buttons read as labels, so they start with a capital: the one
   * exception in the chrome is the log-level filter, which mirrors the tags its
   * own lines print. */
  ['page buttons are capitalised', navLabels().every((l) => /^[A-Z]/.test(l)) && navLabels().length >= 3],
  ['the status panels are drawn on the board as a display icon', (html.match(/class="panel (left|right)/g) ?? []).length === 2
    /* The name and the widget count are no longer printed inside a one-key-wide
     * strip: they are what the control says it is, and the glyph is what it
     * looks like. */
    && html.includes('aria-label="screen 1: 18/24"')
    && !html.includes('plabel')],
  /* The search sits on the bar rather than behind a group that has to be opened
   * first, and the category step is what is drawn before anything is typed. */
  [
    'the dock is searchable without typing',
    dock.includes('type="search"') && dock.includes('search keys…') && !dock.includes('class="disc"'),
  ],
  ['layer names', ['HOME', 'NAV', 'FUN', 'MOUSE', 'MEDIA', 'GAME'].every((n) => html.includes(n))],
  ['the edited keycap', html.includes('A')],
  /* The settings page shows what the keyboard reported, named by the Kconfig it
   * came from: the flashed CONFIG_ZMK_IDLE_SLEEP_TIMEOUT is 900000 ms. */
  [
    'the settings page shows the firmware timeouts',
    ['CONFIG_ZMK_IDLE_TIMEOUT', 'CONFIG_ZMK_IDLE_SLEEP_TIMEOUT', '900000', '15 min'].every((s) =>
      settingsView.includes(s),
    ),
  ],
  /* A row only exists if the firmware can write it, so the host-side habits that
   * are not firmware settings are not on this page. */
  [
    'the settings page offers only what the firmware can write',
    ['autosave', 'keyboard name', 'default output'].every((s) => !settingsView.includes(s)),
  ],
  /* The settings menu splits the table: the configuration page keeps the timeouts
   * and never shows a color, the LED page shows the colors and none of the timing. */
  [
    'the settings menu splits configuration from LED',
    !settingsView.includes('CONFIG_ZMK_STATUS_LED_BRIGHTNESS_PERCENT') &&
      ledView.includes('CONFIG_ZMK_STATUS_LED_BRIGHTNESS_PERCENT') &&
      !ledView.includes('CONFIG_ZMK_IDLE_TIMEOUT'),
  ],
  /* The sound page is one section, not two cards side by side: the event table
   * first, the shapes of the sounds it can play under it. */
  [
    'the sound page is one section, events then sounds',
    (soundView.match(/class="s-card"/g) ?? []).length === 1 &&
      soundView.indexOf('>what plays for each event<') < soundView.indexOf('>the sounds<') &&
      soundView.includes('>what plays for each event<'),
  ],
  ['reserved position is marked', (html.match(/class="cap[^"]*reserved/g) ?? []).length === 2],
  ['token picker renders its token step', picker.includes('position 12') && picker.includes('choose a token')],
  ['picker groups tokens by category', (picker.match(/class="cat"/g) ?? []).length >= 5 && (picker.match(/class="token"/g) ?? []).length > 0],
  /* The legend moved behind the ? button, so the page must keep the route to it
   * while losing the wall of text under the grid.
   */
  ['hints are behind a ? button', html.includes('help-btn') && !html.includes('class="legend"')],
  /* The panel editor draws the firmware's logical space, not a picture of a
   * screen: one row per widget, one group per shape, and a hit area over each. */
  ['panel editor draws the keyboard table', (panel.match(/class="widget[ "]/g) ?? []).length === display.widgets.length],
  ['panel editor exposes widget properties and a close button', panel.includes('aria-label="Panel editor"') && panel.includes('+ Widget') && panel.includes('aria-label="close the panel editor"')],
  ['panel preview is the logical space', panel.includes('viewBox="0 0 68 160"')],
  ['panel preview shapes match the table', (panel.match(/<g class="w/g) ?? []).length === display.widgets.length],
  ['every widget has a hit area', (panel.match(/class="hit"/g) ?? []).length === display.widgets.length],
  ['pip row uses the keyboard layer count', display.layerCount === 6],
  /* The read-out is the same resolved binding the cap is drawn from, and the
   * only control in it is the one that leaves the tester rather than writing. */
  [
    'the tester read-out is read-only',
    readout.includes('>12</b>')
      && readout.includes('never reported')
      && !readout.includes('<input')
      && readout.includes('go to the keymap view'),
  ],
]

/* The other half of the shell: with no keyboard the page must not draw a layout
 * no keyboard confirmed - it asks for the connection instead.
 */
const offlinePinia = createPinia()
const offlineApp = createApp(App)

offlineApp.use(offlinePinia)

const offlineHtml = await renderToString(offlineApp)

checks.push(
  ['no keyboard shows the Connect card', offlineHtml.includes('connect-card')],
  ['Connect is the biggest control', /class="btn connect"/.test(offlineHtml)],
  ['no keycaps are drawn without a keyboard', !offlineHtml.includes('class="cap')],
)

/* /demo is the same shell with the simulated keyboard as its device: it must not
 * offer a Bluetooth connection, and the home page must not offer the mock. */
const demoPinia = createPinia()
const demoApp = createApp(App, { demo: true })

demoApp.use(demoPinia)

const demoHtml = await renderToString(demoApp)

checks.push(
  ['demo page names itself', demoHtml.includes('demo-tag')],
  ['demo page offers no Bluetooth chooser', !demoHtml.includes('Show all devices')],
  ['home page no longer offers the simulated keyboard', !offlineHtml.includes('Simulate keyboard')],
)

for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`)

  if (!ok) {
    process.exitCode = 1
  }
}

console.log(`rendered ${html.length} bytes`)
