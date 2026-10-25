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

const panel = await renderToString(createApp(PanelEditor).use(pinia))

const picker = await renderToString(
  createApp(KeyPicker, { pos: 12, reserved: false }).use(pinia),
)

const checks: Array<[string, boolean]> = [
  ['keyboard grid', html.includes('class="row"')],
  ['60 positions', (html.match(/class="cap/g) ?? []).length === 60],
  ['grid slots with no switch render as placeholders', (html.match(/class="slot"/g) ?? []).length === 12],
  /* The cap order IS the transform: the right half runs from the split gap out
   * to its outer corner, so position 11 lands last, not first. A view that
   * sorted each half by column number would flip the whole right hand. */
  ['caps render in matrix-transform map order', capsDrawnInMapOrder(html)],
  ['6 layer tabs', (html.match(/class="tab/g) ?? []).length === 6],
  ['layer names', ['HOME', 'NAV', 'FUN', 'MOUSE', 'MEDIA', 'GAME'].every((n) => html.includes(n))],
  ['the edited keycap', html.includes('A')],
  ['reserved position is marked', (html.match(/class="cap[^"]*reserved/g) ?? []).length === 2],
  ['token picker renders', picker.includes('Inherit') && picker.includes('Disable')],
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
]

/* The other half of the shell: with no keyboard the page must not draw a layout
 * no keyboard confirmed - it asks for the connection instead.
 */
const offlinePinia = createPinia()
const offlineApp = createApp(App)

offlineApp.use(offlinePinia)

const offlineHtml = await renderToString(offlineApp)

checks.push(
  ['no keyboard shows the Connect card', offlineHtml.includes('No keyboard connected')],
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
