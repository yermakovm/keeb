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
│   └── mockKeyboard.ts        ← a simulated firmware, same interface
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
| `matrix-transform` map | `GRID` in `zmk.gen.ts`, in map order, so position N is where the keyboard renders it |
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
so the UI is developed and tested against a keyboard that behaves like the
firmware, without hardware.

## Connect to the real keyboard

`ParamPanel` → **Bluetooth…**. Web Bluetooth needs a secure context
(`localhost` or HTTPS) and a browser that implements it (Chrome, Edge). The
keyboard must advertise the vendor service:

```
service  4b454542-0000-0001-9c41-4b4542544c56
  cmd    4b454542-0000-0002-…   write without response
  evt    4b454542-0000-0003-…   notify
```

If the reported token hash differs from the generated table, the UI says so and
refuses writes: run `npm run gen` and rebuild rather than pushing a layout the
keyboard would misread.

## Editing

- Click a cap → token picker (categories, greyed out if the firmware has no
  driver for it) → parameters. Keycodes are searchable; layers are chosen by
  name and sent as ids; mouse/BT/output tokens have their own editors.
- Edits stay local until **Push**, which sends one `CELLS_SET` per dirty layer
  (the firmware applies it all-or-nothing), then re-reads that layer.
- **Save** writes to the keyboard's settings storage, **Discard** reverts to the
  keymap file, **Reset** clears the saved overlay. The keyboard's own revert
  chord does the same thing without the app.
- Layer tabs show slot → id, live/locked state from the keyboard, and a dirty
  count. Rename, move, add, remove, restore map straight to firmware requests.

## Not done yet

- Reconnect / link-loss handling.
- `.keymap` text export (the app writes into the firmware's settings store; the
  devicetree file stays the factory default).
- Settings and image namespaces (`SETTINGS`, `IMAGE`) — protocol constants are
  already mirrored, no UI.
- Everything is untested against real hardware.
