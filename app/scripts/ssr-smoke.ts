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
import { useDeviceStore } from '../src/stores/device.ts'
import { useKeymapStore } from '../src/stores/keymap.ts'
import { KEYCODES, TOKENS } from '../src/proto/zmk.gen.ts'

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)

const device = useDeviceStore()
const keymap = useKeymapStore()

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

keymap.setBinding(0, 12, { token: kp, param1: KEYCODES.A, param2: 0 })

const commit = await keymap.commitLayer(0)

if (!commit.ok) {
  fail(`commit failed: ${commit.reason}`)
}

const html = await renderToString(app)

const picker = await renderToString(
  createApp(KeyPicker, { pos: 12, reserved: false }).use(pinia),
)

const checks: Array<[string, boolean]> = [
  ['keyboard grid', html.includes('class="row"')],
  ['60 positions', (html.match(/class="cap/g) ?? []).length === 60],
  ['6 layer tabs', (html.match(/class="tab/g) ?? []).length === 6],
  ['layer names', ['HOME', 'NAV', 'FUN', 'MOUSE', 'MEDIA', 'GAME'].every((n) => html.includes(n))],
  ['the edited keycap', html.includes('A')],
  ['reserved position is marked', (html.match(/class="cap[^"]*reserved/g) ?? []).length === 2],
  ['token picker renders', picker.includes('Inherit') && picker.includes('Disable')],
  ['picker groups tokens by category', (picker.match(/class="cat"/g) ?? []).length >= 5 && (picker.match(/class="token"/g) ?? []).length > 0],
]

for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`)

  if (!ok) {
    process.exitCode = 1
  }
}

console.log(`rendered ${html.length} bytes`)
