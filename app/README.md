# keeb configurator (web UI)

Vue 3 + Vite + Pinia + TypeScript. Styled after the ZSA Oryx configurator, but
the model underneath is the **firmware's**, not a web app's: the UI speaks the
KEEB TLV protocol directly and keeps a mirror of the keyboard's state, so the
keyboard stays the source of truth.

```
app/
├── scripts/gen-contract.mjs   ← generates src/proto/zmk.gen.ts and src/proto/protocol.gen.ts from the repo
├── src/proto/                 ← the protocol; its numbers come from keeb-module/proto/keeb_tlv_*.h
│   ├── protocol.gen.ts        ← GENERATED: every constant, flag, type id, error code, event, plus each wire struct's size and field offsets
│   ├── constants.ts           ← re-exports that, plus what a generator cannot see: the function-like macros, the BLE MTU arithmetic, the UUIDs, the error-text table
│   ├── types.ts               ← the packed structs as interfaces + UI models
│   ├── crc32.ts               ← bitwise CRC-32/IEEE, identical to the C implementation
│   ├── tlv.ts                 ← builder, reassembly, fragmentation, payload readers
│   └── zmk.gen.ts             ← GENERATED: token table, grid, shipped keymap, keycodes
├── src/transport/
│   ├── types.ts               ← KeebTransport: the only thing a link must provide
│   ├── ble.ts                 ← Web Bluetooth (write-without-response + notify)
│   └── mockKeyboard.ts        ← test double for that firmware, same interface
├── src/stores/
│   ├── device.ts              ← session, capabilities, token verification, every request
│   └── keymap.ts              ← slots, ids, live model, pending edits
├── src/model/cap.ts           ← {token, param1, param2} → what a keycap shows
├── src/data/keycodes.ts       ← curated picker catalog over the generated table
└── tests/                     ← codec, wire-layout, session, store tests (node --test, no runner)
```

## Run

```sh
cd app
npm install
npm run dev          # http://localhost:5173 — opens against the simulated keyboard
npm run check        # typecheck + tests + render smoke test
npm run gen          # regenerate src/proto/zmk.gen.ts
npm run build        # production bundle in app/dist (gitignored)
```

`npm run gen` needs the pinned ZMK checkout next to this repo (`../zmk`, or
`ZMK_DIR=/path`). It reads `config/keeb.dtsi` and `config/keeb.keymap`, expands
the ZMK keycode macros, and writes the contract table. Run it whenever the
firmware's token table or matrix changes.

## How the models match the firmware

| firmware | UI |
|---|---|
| cell identity = **stock position 0..59** | every lookup is by position; the `L/R.row.col` addressing the old UI invented is gone |
| `matrix-transform` map | `GRID` in `zmk.gen.ts`, in map order; `gridHalf()` draws each half in that same order (left half cols 0-5 outer edge → gap, right half cols 11-6 gap → outer edge), so cap N is the key at position N, and grid slots the transform does not map render as dashed placeholders |
| binding = `{token, param1, param2}` | `Binding` in `src/proto/types.ts`; the old `{kind, code}` is gone |
| token table = `keeb,engine` `tokens` in `keeb.dtsi` | `TOKENS` in `zmk.gen.ts`, with `binding-cells` and the C display name |
| `token_table_hash` | `EXPECTED_TOKEN_HASH`, and `device.ts` compares it against the live device before allowing a write |
| layer **slot** vs layer **id** | `keymap.order: number[]` (slot → id), `LAYER_ID_INVALID = 0xff` for an empty slot |
| active/locked layer bitmasks | `keymap.layerState` / `keymap.layerLocked`, fed by `KEEB_EV_LAYER_STATE` |
| "missing binding" | `&trans` (inherit, walked down the slots) or `&none` (a real binding that does nothing) — absence is not a state |
| reserved positions | `RESERVED_POSITIONS` from `keeb,engine reserved-positions`; refused locally and flagged on the cap |
| one message in flight (`KEEB_ERR_BUSY`) | `device.ts` serialises requests in a queue |

`mockKeyboard.ts` implements the same dispatch rules as `keeb_engine.c` —
all-or-nothing cell writes, reserved refusal, `KEEB_TOKEN_NONE` refusal, unknown
token refusal, paginated token table, notifications after a successful write —
so the protocol and the stores stay testable without hardware. It is a **test
double**: the tests and the SSR smoke render speak to it, and nothing in the UI
can reach it. The app only ever talks to a real keyboard.

## Connect to the real keyboard

On load the page reconnects by itself when this browser already has a grant for
a keyboard: `getDevices()` is the one Web Bluetooth call that needs no user
gesture, so a session survives a reload. When it cannot - no saved grant, the
keyboard asleep, or holding another host's profile - the page shows the Connect
card instead of a layout no keyboard confirmed.

Web Bluetooth needs a secure context (`localhost` or HTTPS) and a browser that
implements it (Chrome, Edge). The keyboard must advertise the vendor service:

```
service  4b454542-0000-0001-9c41-4b4542544c56
  cmd    4b454542-0000-0002-…   write without response
  evt    4b454542-0000-0003-…   notify
```

**What the chooser filters on.** The advertised **name** (`config/keeb.conf`
→ `KEYBOARD_NAME` in `zmk.gen.ts`), because that is the only narrowing this API
allows for this device. ZMK advertises appearance 0x03C1 (keyboard) and the
services 0x1812 HID + 0x180F Battery (`zmk/app/src/ble.c`, `zmk_ble_ad`), but
**0x1812 is on the Web Bluetooth GATT blocklist**
(`WebBluetoothCG/registries/gatt_blocklist.txt`: direct access to HID devices
would let pages become keyloggers), and a blocklisted service in `filters` is a
`SecurityError`, not a shorter list. So "show only HID devices" is not available
- it is forbidden. The KEEB service is not advertised at all, so it belongs in
`optionalServices`, which is what makes `getPrimaryService` legal after a
name-filtered connect. **show all devices** is the escape hatch when the name the
browser sees is not the name the contract expects (renamed the keyboard without
re-running `npm run gen`).

**Forget saved devices.** Chrome keeps grants across reloads *and* across a
firmware flash, and still lists them when they are not advertising; picking one
of those is the "Unsupported device" error. There is no way to remove a single
entry from the chooser, so the panel forgets them all (`device.forget()` →
`BluetoothDevice.forget()`) and the next connect starts clean. Do this before
re-pairing, and after a flash.

A **keyboard-side reset is the other half of this**: `BT_CLR`/`BT_DEL`, a
re-flash, or clearing bonds leaves the bond gone on the keyboard while Chrome
still holds its grant, so a saved entry connects at the BLE level and then fails
when the `cmd` characteristic refuses an unencrypted write (`keeb_ble.c` requires
encryption). `Forget device` in the panel plus `Connect` is the path; the Connect
card also carries a **re-pair** that does both inside one click, which is what
`requestDevice()`'s user-activation rule requires. Note the OS is a separate
bond: if macOS is paired with the keyboard, forget it in Bluetooth settings too —
the browser cannot revoke that.

The app's **Reset settings** is not a pairing action: it clears the keymap
settings subtree (`zmk_keymap_reset_settings`) and leaves bonds alone.

If the reported token hash differs from the generated table, the UI says so,
lists which tokens disagree, and refuses writes. The hash proves the tables
differ, not which side is stale: if `keeb.dtsi` changed since this keyboard was
flashed, run `npm run gen`; if it did not, the keyboard is running an older
image — rebuild and reflash the central half. Do not push a layout the keyboard
would misread.

**Which half answers the channel.** Only the **central** (left) half can serve
the configurator. ZMK sizes `CONFIG_BT_MAX_CONN` per split role — 6 for the
central, 1 for the peripheral (`zmk/app/src/split/bluetooth/Kconfig.defaults`) —
and the peripheral's single BLE link is the split connection to the central, so
an attempt to connect to the right half fails at the GATT stage. Both halves
advertise under the same name (`CONFIG_ZMK_KEYBOARD_NAME` lives in the shared
`config/keeb.conf`), so the Web Bluetooth chooser shows two identical entries
and one of them can never work. Set the name per half in
`keeb-module/boards/shields/keeb/keeb_left.conf` / `keeb_right.conf` if you want
them distinguishable.

**Pairing.** `cmd` is `BT_GATT_PERM_WRITE_ENCRYPT`, so every request needs an
encrypted link, and Zephyr does not start pairing when a write arrives: it just
answers Insufficient Authentication. The keyboard therefore requests pairing as
soon as a host subscribes to `evt` - the one act that identifies a configurator
rather than the other half of the split. ZMK still decides: pairing onto a
profile another host already holds is refused (`zmk/app/src/ble.c:
auth_pairing_accept`), only LE Secure Connections pairing is accepted
(`CONFIG_BT_SMP_SC_PAIR_ONLY`), and a keyboard whose active profile is connected
stops advertising, so it will not appear in the chooser at all. Free a profile
first (`BT_SEL` to one that is not stored, or `BT_CLR` for the current one) and
make sure no other host is holding the link.

Reading can work without a bond (the `evt` CCCD is writable unencrypted); a
write cannot. If the link's MTU cannot carry even the smallest KEEB packet the
transport reports it instead of re-sending the same fragment forever.

## The arrangement on the screen

The grid is drawn from a **layout preset** (`src/model/layouts.ts`), selected in
the keyboard header. A preset says only which column slots of each row hold a
switch — never what a key does; position numbers still come from the firmware's
matrix transform.

- **cosmotyl** (the default) is not hand-drawn: it is read back out of `GRID`, so
  the preset and the board the configurator is talking to cannot drift apart. Its
  thumb row states both halves explicitly, because that row is not
  mirror-symmetric.
- `corne`, `sofle` and `grid6` are real boards, offered anyway. A preset that does
  not match the keyboard is a **mismatch the view reports**, not something dropped
  silently: `overflow` names the positions with nowhere to draw, `empty` counts the
  slots drawn with no switch in them. `tests/layouts.test.ts` pins both.
- The caps stay interleaved row by row — left half, right half, next row — because
  that is the order the transform lists positions in. The half outlines are drawn
  over that grid rather than wrapping it, and the SSR smoke test fails if the cap
  order stops matching the map order.
- The case is one outline around both halves plus one per half, and `positions`
  prints the stock number in each cap's corner for matching a cap to a `CELLS` record.
- The split is **two key widths wide**, because that is where the status panels
  are drawn: one vertical strip per half, each **one key wide** (the footprint of
  two keys stacked), against the inner column — next to `T`·`G` on the left,
  `Y`·`H` on the right — labelled `screen 1` / `screen 2`. They are buttons.
  Clicking one is how a panel is edited; there is no displays page.
- Everything that positions something *inside* the case (`--half-w`, `--frame-w`,
  `--split`, `--panel-w`) is declared on the case, after `--cell` is clamped. A
  custom property is substituted where it is **declared**, so declaring them
  against the fallback cell size measures the halves at 46px while the grid draws
  them smaller — which is how one screen ended up exactly on top of the other.
- The menu is `keymap`, `tester`, `settings`. Layers and panels are edited where
  they are drawn, so they are not menu items.
- Below the board is one slot that holds whatever the board is pointing at: the
  **keycode palette** for a key, the **widget table** for a panel, the **event
  log** for the tester.

Dark and light are the same layout with the ground inverted, flipped by the
header button and remembered per browser (`localStorage` key `keeb.theme`).
Everything is rectangular and monospace by construction — `border-radius: 0` is
set globally in `src/styles/theme.css`.

**The page is grey on purpose.** The accent is reserved for the controls that
*send something to the keyboard* — `save to device`, `connect`, the picker's
`apply`, the panel's `apply panel` — and for the footer mode block while it reads
`EDIT`, which means exactly that something staged has not been sent. The grid,
the tabs, the nav and the log say themselves in grey, in weight, or by inverting
ground and ink: a cap defined on this layer gets a stronger grey border, a staged
cell gets a thick inner ring, a selected cap inverts. A keycap and a write
button must never be confused for each other.

## Editing

- Click a cap to **select** it — the cap inverts, ground and ink swapped, the way
  a vim visual selection reads. A key and a panel cannot both be selected: the
  bottom section and the sidebar can only speak about one thing at a time.
- The **bottom palette** (`src/components/KeyPalette.vue`) is the mouse route to a
  keycode: choose a category, and **every group in it is drawn with its keys** —
  no step that hides them, no empty panel waiting for input. The wrapper is chosen
  by which key you click (`&kp` / `&kt` / `&sk`), so no text field is needed to
  repair a keyboard that cannot type. The search field is on the surface and
  filters the same list as you type (by name or by label); typing without choosing
  a category searches the whole catalog. It is a shortcut, never the only path.
  Mouse bindings are not filled in by that wrapper choice — `&mkp`, `&mmv` and
  `&msc` take vectors and masks rather than a keycode, so they belong to the
  **advanced binding** group below. (The palette's *mouse* category still offers
  them as `&kp` chips; that gap is open — see `docs/tasks.md`.)
- The **sidebar** carries the properties of the selected key: `&trans`, `&none`,
  `unstage`, and one `&mo` chip per layer slot.
- Bindings with more than one argument — hold/tap, mouse vectors, BT commands,
  output — are the **advanced binding** group in that same column: the token
  picker (categories, greyed out if the firmware has no driver for it) with its
  own parameter editors. It is a `[+]` group like **state** and **session** are,
  not a button and not a popup — the popup hid the grid the write was for.
  **unstage** drops one cell's staged binding and re-reads that layer, so the
  keyboard's own binding for that position comes back without touching the
  other staged keys on the layer.
- **What the sidebar hides.** Only what gets rebound every session is on the
  surface: the search, the `&mo` chips, `&trans` / `&none` / `unstage`.
  `&kt` and `&sk`, `&to` / `&tog` / `&sl`, the no-argument behaviors, the
  advanced binding picker, the cap-state diagnostics and the autosave preference
  sit behind
  `[+]` group headers that start closed (`src/components/Disclosure.vue`) —
  `ssr-smoke` asserts they are not in the markup until opened, and that the only
  layer chips on the surface are the momentary ones.
- Selecting a key only **stages** it (green corner dot on the cap). Nothing
  reaches the keyboard until **Apply changes**, which sends one `CELLS_SET` per
  dirty layer (the firmware applies it all-or-nothing), then re-reads that layer.
  **Revert** throws the staged edits away and shows the keyboard's layout again -
  it was never asked to change.
- **Autosave** (on by default, remembered per browser) sends `SAVE` immediately
  after a write the keyboard accepted, including layer renames, moves, adds and
  removes. Applying and persisting are two firmware operations — `CELLS_SET`
  changes the live keymap, `SAVE` writes it into ZMK's settings storage, and
  only the second survives a reboot — so with autosave off the panel says how
  many changes are live but unsaved, and a refused `SAVE` is reported as a
  failure rather than as success.
- **Save** writes to the keyboard's settings storage, **Discard** returns to the
  saved overlay (the keymap file when nothing is saved), **Reset** clears the
  saved overlay. With autosave on almost every change is saved, so **Reset** is
  the way back to the flashed keymap (the revert chord runs the same operation
  as Discard today, so it does not clear a saved layout either).
- Layer tabs show slot → id, live/locked state from the keyboard, and a dirty
  count. Rename, move, add, remove, restore map straight to firmware requests.
- **status panels** are edited where they are drawn. Clicking `screen 1` / `screen 2`
  on the board puts the widget table in the bottom slot and the panel's properties
  in the sidebar. The left column is the firmware's logical space drawn from the
  table the keyboard reported — `68×160` rotated 90° into the `160×68` glass on
  this build — and clicking a shape selects the widget that drew it. The right
  column is the table: kind, source, geometry, and the style control that kind
  actually uses (radius, font + alignment, pip size, fill mode, art anchor).
  - **Apply panel** sends one `DISPLAY_SET` with the whole table; the firmware
    validates every entry before drawing any of it, and the same rules are
    checked here first so a control cannot offer a widget the panel refuses.
  - **Save / Discard / Reset** are the panel's own settings operations —
    applying redraws, saving is what survives a reboot.
  - Limits come from `DISPLAY_INFO`, never from this app: widget count, slot
    count, slot length in **bytes**, which kinds exist, which sources can feed
    them, whether artwork is drawable here, and how many pips a pip row draws.
    The panel is not in devicetree, so there is nothing to generate them from.
  - **Text slots** are the only strings the app can write, and a widget has to
    point at a slot to show it. **Value slots** are live numbers: they redraw,
    and `Save` never writes them, because a number pushed from a browser is not
    a setting.
  - Values the keyboard owns are not editable: layer, battery, link, charging
    and the connected device are read from ZMK at draw time. The preview shows
    placeholders where they will land.
- The **?** button (bottom right) holds the reference text: what the cap styling
  means, how slots and ids differ, staging vs applying vs saving, and what to do
  when the token table, the pairing, or the advertising is the problem. Esc or a
  click outside closes it.

## Testing the switches

The `tester` view draws the same board as the keymap and lights the switches the
keyboard says are closed, in the same inversion a selected cap uses. It exists
because "row 3 is dead" is a question about the matrix, not about bindings.

A keyboard does not report keypresses by default, so it is a mode the app asks
for and gives back:

- `TEST_SET` (`src/proto/protocol.gen.ts`, `KEEB_T_TEST_SET`) turns reporting on
  or off; the keyboard answers with the mode it ended up in, and the store keeps
  the **confirmed** value rather than the requested one.
- While it is on, the firmware's position listener (`keeb-module/engine/keeb_engine.c`,
  `zmk_position_state_changed`) sends `EV_KEY` with `pos`, `pressed` and the
  active `layer` — the position the transform assigned, not a matrix row/col the
  host would have to guess.
- The mode is cleared when the transport detaches, and when the tester view
  closes. A configurator that left it set would keep a keyboard streaming
  keystrokes nobody is reading.
- `src/stores/tester.ts` keeps the pressed set (for the caps), a bounded ring of
  events (for the log), press/release counts, which positions have ever reported,
  and the last error. The log names time, position, the row and column that
  position sits on, its side, the layer id and name, whether the switch closed or
  opened, and what binding is there — which is enough to tell a dead switch from a
  dead row.
- On the simulated keyboard, clicking a cap presses its switch for 220 ms through
  the same notification path real hardware uses, so the tester is testable and
  tested without a board (`tests/tester.test.ts`).

## Debugging the channel

Every message is traced, on both sides.

**Host** (`src/debug/trace.ts`, written from `stores/device.ts`): one console
line per message, prefix `keeb tlv`.

```
keeb tlv  tx  #7  CELLS_SET(0x1003)  812B
keeb tlv  ack #7  ACK(0x1000) CELLS(0x1002)  96B  OK detail=12
keeb tlv  evt     CELLS_SET seq 3  3B
keeb tlv  err #9  no ACK for message 9 in 4000ms
```

On in a browser by default; `localStorage.setItem('keeb.debug', '0')` silences
it (`?debug=0` for one load, `'1'` / `?debug=1` turns it back on). Off outside a
browser so the tests and the SSR render stay readable. The same history is kept
in `device.traceLog` for anything that wants to render it, and record names come
from the mirrored constants (`KEEB_T_*` / `KEEB_EV_*`), so the trace cannot drift
from the protocol it names.

**In the page** (`src/stores/log.ts`, `src/components/LogPanel.vue`): the `log`
button in the status line opens a bottom-right panel holding the same lines —
`tx` / `ack` / `evt` / `err` straight from the trace, plus every line the
configurator said out loud (`ui`). It is a **second reader** of the trace, not a
replacement for it: the transport is not pointed at the store, so it cannot
refuse to write. Attaching backfills what already happened, the ring keeps the
last 400 lines, the button carries an error count while the panel is closed, and
Esc closes it. The button is useful with no keyboard at all — a failed pair
leaves lines here that the console also got.

**Firmware** (`keeb-module/engine/keeb_engine.c`, `CONFIG_ZMK_LOG_LEVEL_DBG=y`):
`tx msg N: <bytes> flags …` for every reply it puts on the wire, `rx msg N: <n>
record(s) -> ack status … err … detail …` for every request it answers, a DBG
line per record, and a WRN for every error ACK. Read it with `make monitor`
(`CONFIG_ZMK_USB_LOGGING=y`), and the two traces describe the same traffic.

## Not done yet

- Link-loss recovery beyond an explicit Reconnect: a dropped link is reported,
  but nothing retries it on a timer.
- `.keymap` text export (the app writes into the firmware's settings store; the
  devicetree file stays the factory default).
- Settings and image namespaces (`SETTINGS`, `IMAGE`) — protocol constants are
  already mirrored, no UI. The panel (`DISPLAY`) is implemented on both sides;
  image upload is not, so the screen can only pick compiled-in artwork.
- Panel edits reach the half that owns the engine (the central). The peripheral's
  table is compiled in and receives the connected device id from the central;
  there is no host-driven peripheral panel yet.
- Everything is untested against real hardware.
