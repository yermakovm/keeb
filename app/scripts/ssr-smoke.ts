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
import { useDeviceStore } from '../src/stores/device.ts'
import { useDisplayStore } from '../src/stores/display.ts'
import { useKeymapStore } from '../src/stores/keymap.ts'
import { KEYCODES, KEY_COUNT, TOKENS } from '../src/proto/zmk.gen.ts'

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)

const device = useDeviceStore()
const keymap = useKeymapStore()
const display = useDisplayStore()

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

/* The palette under the board, sliced for the same reason as the sidebar. */
const palette = html.slice(
  html.indexOf('class="palette"'),
  html.indexOf('</section>', html.indexOf('class="palette"')),
)

const panel = await renderToString(createApp(PanelEditor).use(pinia))

const picker = await renderToString(
  createApp(KeyPicker, { pos: 12, reserved: false }).use(pinia),
)

/* The tester's variant of the same properties: it reads the keyboard, so it
 * must not carry an input or a write. */
const readout = await renderToString(createApp(KeyReadout, { pos: 12 }).use(pinia))

const checks: Array<[string, boolean]> = [
  ['keyboard grid', html.includes('class="row"')],
  ['60 positions', (html.match(/class="cap/g) ?? []).length === 60],
  ['grid slots with no switch render as placeholders', (html.match(/class="slot"/g) ?? []).length === 12],
  /* The cap order IS the transform: the right half runs from the split gap out
   * to its outer corner, so position 11 lands last, not first. A view that
   * sorted each half by column number would flip the whole right hand. */
  ['caps render in matrix-transform map order', capsDrawnInMapOrder(html)],
  /* `tab[ "]` and not `tab`: the wrapper around the tabs is class="tabs", and a
   prefix match would count it as a seventh tab. */
  ['6 layer tabs', (html.match(/class="tab[ "]/g) ?? []).length === 6],
  /* The arrangement is a preset, and the case is drawn as an outline around both
   * halves. The default preset is the board itself, so it must be the one the
   * page draws and the one the select marks. */
  ['case outline drawn', html.includes('class="case"') && html.includes('data-layout="cosmotyl"')],
  ['layout presets selectable', html.includes('value="cosmotyl"') && html.includes('value="corne"')],
  ['log panel reachable from the footer', html.includes('term-btn')],
  /* The sidebar carries quick binding actions (trans, none, unstage).  The
   * actual layer ops moved to the palette under the board. */
  ['sidebar carries the binding editor', aside.includes('class="bind') && aside.includes('&amp;trans') && aside.includes('&amp;none')],
  /* What a person rebinds every session is on the surface; what they rebind once
   * in a build is behind a group that starts closed. The closed groups are not in
   * the markup at all, so this is a real assertion about the default state and
   * not about styling. */
  [
    'everyday bindings are on the surface',
    ['&amp;trans', '&amp;none', 'unstage'].every((s) => aside.includes(s)),
  ],
  /* The multi-argument picker is a group in this column, the same kind of group
   * the state and the session are: no button opens it, and nothing is fixed over
   * the page. */
  [
    'the advanced picker lives in the palette, not the sidebar',
    palette.includes('layers') && palette.includes('dual-function') && !aside.includes('advanced binding') && !html.includes('class="overlay"'),
  ],
  [
    'occasional bindings are in the palette, not the sidebar',
    ['&amp;mo', '&amp;to', '&amp;tog', '&amp;sl', '&amp;lt'].every((s) => !aside.includes(s)),
  ],
  /* Layer ops are in the palette with a stepped flow: choose category, then op,
   * then layer (and keycode for lt).  No hidden groups in the sidebar. */
  ['palette has keys and behaviors tabs', palette.includes('Keys') && palette.includes('Behaviors')],
  /* The board is the page: the things you do to it are views of it, not rooms.
   * A tester is a second view of the same board; the panels and the layer list
   * are edited where they are drawn. */
  [
    'the menu holds the board, not a room per feature',
    ['keymap', 'tester', 'settings'].every((s) => nav.includes(s))
      && ['displays', 'macros', 'layers'].every((s) => !nav.includes(`>${s}<`)),
  ],
  ['the status panels are drawn on the board as a display icon', (html.match(/class="panel (left|right)/g) ?? []).length === 2
    /* The name and the widget count are no longer printed inside a one-key-wide
     * strip: they are what the control says it is, and the glyph is what it
     * looks like. */
    && html.includes('aria-label="screen 1: 18/24"')
    && !html.includes('plabel')],
  /* The palette under the board: the search sits on the surface rather than
   * behind a group that has to be opened first, and the category step — not an
   * empty list waiting for typing — is what is drawn before anything is typed. */
  [
    'the keycode palette is reachable without typing',
    palette.includes('type="search"') && palette.includes('letters · numbers') && !palette.includes('class="disc"'),
  ],
  ['layer names', ['HOME', 'NAV', 'FUN', 'MOUSE', 'MEDIA', 'GAME'].every((n) => html.includes(n))],
  ['the edited keycap', html.includes('A')],
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

for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`)

  if (!ok) {
    process.exitCode = 1
  }
}

console.log(`rendered ${html.length} bytes`)
