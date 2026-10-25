# keeb configurator (web UI)

Vue 3 + Vite + Pinia + TypeScript. Styled after the ZSA Oryx configurator, but
the model underneath is the **firmware's**, not a web app's: the UI speaks the
KEEB TLV protocol directly and keeps a mirror of the keyboard's state, so the
keyboard stays the source of truth.

```
app/
├── scripts/gen-contract.mjs   ← generates src/proto/zmk.gen.ts from the repo
├── src/proto/                 ← the protocol, mirrored from keeb-module/proto/keeb_tlv.h
│   ├── constants.ts           ← every constant, flag, type id, error code, event
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
└── tests/                     ← codec, session, store tests (node --test, no runner)
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

## Editing

- Click a cap → token picker (categories, greyed out if the firmware has no
  driver for it) → parameters → **Apply**. Keycodes are searchable; layers are
  chosen by name and sent as ids; mouse/BT/output tokens have their own editors.
  **Apply** stages the binding and closes the picker - the grid is where the
  result is checked, and **Inherit** / **Disable** do the same in one click.
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
- **status panel** (the tab next to the keymap) edits the screen on the halves.
  The left column is the firmware's logical space drawn from the table the
  keyboard reported — `68×160` rotated 90° into the `160×68` glass on this build
  — and clicking a shape selects the widget that drew it. The right column is
  the table: kind, source, geometry, and the style control that kind actually
  uses (radius, font + alignment, pip size, fill mode, art anchor).
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
