# Tasks — live keymap / layer mutation engine (TLV over BLE GATT)

Goal: the keyboard accepts a TLV-encoded config over BLE GATT from our own
configurator and rebinds keys / reorders layers live, persisting the result.
ZMK Studio is **not** used — the protocol, codec, dispatcher and safety layer
are written from scratch. Later phases extend the same engine with settings
(sleep timeout) and screen images; keys/layers come first.

Status: **Phase 0 + Phase 1 (firmware side) + the Phase 2 reserved-position
guard are implemented and building; the codec is host-tested. Phase 3 (the
configurator app) is implemented against a simulated firmware and has not been
run against hardware.** Not started: the BLE host CLI, the split relay of layer
names. Nothing has been tested on hardware yet.

Firmware side as built (names differ from the sketch below):

| plan name | actual |
|---|---|
| `proto/keeb_tlv.*` | `keeb-module/proto/keeb_tlv.h` + `.c`, tested by `tools/tlv_test.c` via `tools/tlv_test.sh` / `make tlv-test` |
| `transport/keeb_transport.h`, `gatt_tlv.c` | `keeb-module/transport/keeb_ble.c` only — the transport is a `keeb_tlv_tx_dev` (one send hook + max fragment), fragmentation lives in the codec, not in a transport base class |
| `engine/keeb_engine.c` | as planned, plus `keeb_engine.h` |
| `keymap/tokens.c` | `keeb-module/keymap/keeb_tokens.c` |
| `keymap/mutate.c` | `keeb-module/keymap/keeb_keymap.c` |
| `keymap/reserved.c` | folded into `keeb_keymap.c` (the guard and the revert chord need the same position state) |
| `transport/split_tlv.c` | not implemented — Phase 1 relay is still open |
| `config/keeb.conf` toggles | not needed: `CONFIG_KBEEB_ENGINE` selects them; declared in `keeb-module/Kconfig`, enabled in `keeb-module/boards/shields/keeb/keeb_left.conf` |

Protocol header is `keeb-module/proto/keeb_tlv.h` (shared with the future JS
codec), and `keeb,engine` devicetree binding is
`keeb-module/dts/bindings/keeb,engine.yaml`.

## Locked decisions

| # | decision | choice |
|---|---|---|
| 1 | Transport | **BLE GATT vendor service** (our own `BT_GATT_SERVICE_DEFINE` in `keeb-module`). No USB/serial TLV product path; serial stays only as a host-side unit-test seam. |
| 2 | Persistence | **Reuse ZMK core** `CONFIG_ZMK_KEYMAP_SETTINGS_STORAGE` (NVS keymap subtree, save/discard/reset). No private keymap blob. |
| 3 | Layer model | **Configurable layers with reordering**: `CONFIG_ZMK_KEYMAP_LAYER_REORDERING=y` + spare placeholder layers in DT for add/remove capacity. |
| 4 | Escape hatch | **Non-rebindable reserved key positions** — TLV refuses to write them, so a config channel can never be locked out by a bad layout. |

## Verified facts (pinned ZMK, workspace `main`) — do not re-derive

- Runtime-mutable keymap is **core, not Studio**: `zmk/app/Kconfig:262`
  `ZMK_KEYMAP_LAYER_REORDERING`, `:265` `ZMK_KEYMAP_SETTINGS_STORAGE`
  (deps `SETTINGS` + `ZMK_BEHAVIOR_LOCAL_IDS`). Studio RPC only *selects* them.
- Core API we build on (`zmk/app/src/keymap.c`, `include/zmk/keymap.h`):
  `zmk_keymap_get_layer_binding_at_idx` (:245), `zmk_keymap_set_layer_binding_at_idx`
  (:280), `zmk_keymap_add_layer` (:366), `zmk_keymap_remove_layer` (:389),
  `zmk_keymap_restore_layer` (:411), `zmk_keymap_move_layer` (:339),
  `zmk_keymap_set_layer_name` (:424), `zmk_keymap_save_changes` (:573),
  `zmk_keymap_discard_changes` (:614), `zmk_keymap_reset_settings` (:655).
  NVS load at boot via `SETTINGS_STATIC_HANDLER_DEFINE(keymap, "keymap", …)` (:967).
- Without `CONFIG_ZMK_STUDIO` the RAM table is DT-initialised and **not** wiped
  at boot (`keymap_init` reloads stock only `#if IS_ENABLED(CONFIG_ZMK_STUDIO)`,
  :972-980) — so saved keymaps survive reboot and DT stays the fallback.
- Binding shape `{ local_id, const char *behavior_dev, param1, param2 }`
  (`include/zmk/behavior.h:16`), resolved by device-name string
  (`zmk_behavior_get_binding`, `src/behavior.c:73`). ⇒ a TLV can only reference
  behaviors compiled into the image. Token table is built at compile time from DT.
- Split: **only the central resolves bindings**; the peripheral executes what the
  central sends (`src/split/peripheral.c:38-56`, `INVOKE_BEHAVIOR`). Mutation is
  central-only; layer **names/art** for the peripheral UI must be relayed by us
  (existing push mechanism: `keeb-module/boards/shields/keeb/ui/layer_sync.c`).
- Binding indices are **stock positions** — mapped through
  `zmk_physical_layouts_get_selected_to_stock_position_map` inside the getters
  above. The configurator grid uses stock indices (the 60-cell grid in
  `config/keeb.keymap`), and the matrix transform stays transparent.
- Layer count is capped by `ZMK_KEYMAP_LAYERS_LEN` (DT-declared layers);
  add/remove/reorder only shuffle slots inside that pool ⇒ spare layers must be
  declared in DT (~1 KB RAM + ~1 KB flash each at 60 positions).
- Sleep timeout is compile-time (`src/activity.c:48` `MAX_SLEEP_MS =
  CONFIG_ZMK_IDLE_SLEEP_TIMEOUT`) ⇒ a runtime value needs our own idle watchdog
  or a minimal core override — later phase, flagged then.
- Layer artwork is const-generated today (`keeb-module/tools/gen_art.py` →
  `ui/art/layer_art_data.c`); "screen images from host" is a storage design, not
  a keymap change.
- Layer names are capped by `CONFIG_ZMK_KEYMAP_LAYER_NAME_MAX_LEN` (default 20).

## Architecture (new code in `keeb-module/`, config in `config/keeb.conf`)

```
keeb-module/proto/     keeb_tlv.h/.c      record codec: magic, version, namespace,
                                         type, length, seq, CRC32; zero-copy
                                         decode + validate, no allocation
keeb-module/engine/    keeb_engine.c      dispatcher: handler registry per
                                         namespace, session state, capability
                                         report, ACK/NACK/ERROR, notify to host
keeb-module/transport/ keeb_transport.h   send/recv + fragment/reassemble
                       gatt_tlv.c         BLE vendor GATT service (write + notify)
                       split_tlv.c        central -> peripheral relay (names, art)
keeb-module/keymap/    tokens.c           compile-time token table from DT: kp, mo,
                                         lt, ht, tt, kc, bt, sys_reset, bootloader,
                                         mmv/mov/mesc, keeb_layer_art, remote_reset
                                         + param metadata for the UI
                       mutate.c           the ONLY file calling ZMK keymap core:
                                         apply/verify/dump/save/discard, layer names
                       reserved.c         reserved positions, lockout protection
```

Engine namespaces are generic so later work lands as handlers, not a rewrite:
`KEYMAP=1`, `SETTINGS=2`, `DISPLAY=3`, `IMAGE=4`.

BLE notes: the vendor service rides the **same** connection as HID (no extra
connection); Zephyr appends `BT_GATT_SERVICE_DEFINE` services to the GATT table,
so no patch to `zmk/app/src/ble.c` / `hog.c` is needed; Web Bluetooth can find
the device by name without changing ZMK's advertising payload.

## TLV schema sketch (versioned, bidirectional)

`HELLO / CAPABILITIES` (fw version, token-table hash, layer capacity, key count,
stock map) · `KEYMAP_DUMP` / `KEYMAP_CELLS` (bulk read-back so the app never
trusts stale local state) · `KEYMAP_SET_CELLS` (batch: layer + stock index +
token + params) · `LAYER_NAME / LAYER_ADD / LAYER_REMOVE / LAYER_MOVE` ·
`SAVE / DISCARD / RESET` · `APPLY_COMMIT / APPLY_CANCEL` (staged apply) ·
`NOTIFY` (layer/name/persist results) · reserved `SETTING_SET / SETTING_GET`,
`IMAGE_BEGIN / CHUNK / COMMIT`.

Handshake carries the **token-table hash** so host and firmware can never
silently disagree about what a token means.

## Phase 0 — core groundwork

- [x] The keymap-core options are on: enabled by `select` from
      `CONFIG_KBEEB_ENGINE` (`keeb-module/Kconfig`), which pulls
      `SETTINGS`, `ZMK_BEHAVIOR_LOCAL_IDS` (+`_IN_BINDINGS`),
      `ZMK_BEHAVIOR_METADATA`, `ZMK_KEYMAP_SETTINGS_STORAGE`,
      `ZMK_KEYMAP_LAYER_REORDERING` — the same prerequisite set ZMK's own
      Studio RPC menu selects (`zmk/app/src/studio/Kconfig`), minus nanopb and
      ring buffer. Verified in `autoconf.h` on the left half and **absent** on
      the right half.
- [ ] `config/keeb.keymap`: spare placeholder layers for add/remove capacity —
      still open, so `LAYER_ADD` will fail with `NO_CAPACITY` until they exist.
- [x] `make clean && make left right` — both halves build. Delta measured
      against the pre-engine build: left 506704 → **523128 B** flash
      (788 KB, 64.83%), RAM **131884 B** of 256 KB (50.31%); right (no engine)
      **408512 B** flash, **101952 B** RAM. The engine's cost is central-side.
- [ ] Debug hook for save/discard/dump from the console — skipped: the TLV
      `INFO`/`CELLS_GET`/`SAVE`/`DISCARD` handlers are the hook, and they are
      reachable from `make tlv-test` only in codec form, not on hardware yet.
- [ ] NVS headroom for the keymap subtree — still open (needs hardware).

**Acceptance:** typing unchanged; discard restores the DT layout; saved changes
survive reboot — **not verified yet** (hardware).

## Phase 1 — codec, dispatcher, BLE transport, keymap mutation

- [x] `proto/keeb_tlv.*` — codec + validator with host tests (`tools/tlv_test.c`
      run by `tools/tlv_test.sh`, also `make tlv-test`): wire-layout offsets,
      CRC-32/IEEE check value, build/iterate round-trip, torn-record rejection,
      header round-trip + byte-order spot check, and loopback through a fake
      link that feeds a real receiver (clean 700 B send, concurrent-send
      refusal, MTU-shrink retry, busy retry, dropped fragment then restart,
      corrupted byte, and every malformed-header path). 84 checks, 0 failures.
      `native_posix` run deliberately skipped: the codec compiles as plain C,
      so the host test covers the same code the firmware links.
- [x] `transport/keeb_ble.c` — vendor service (`KEEBTLV` UUIDs, service
      `0x…0001`, write `0x…0002`, notify `0x…0003`), write-without-response
      handler requiring encryption, CCC-tracked notify path, fragment size from
      `CONFIG_BT_L2CAP_TX_MTU - 3` with a `BUILD_ASSERT` that it still fits a
      header plus 20 payload bytes. The notify attribute is found by UUID scan
      of the generated table instead of a hard-coded index, because a Zephyr
      rebase moves that table.
- [x] `engine/keeb_engine.c` — dispatch by type namespace, per-message ACK with
      the first failure code, `KEEB_ERR_BUSY` while a reply is owed (which is
      how the session serialises without a mutex: the reassembly slot and both
      TX buffers stay held until the reply is delivered), notify queue, and a
      layer-state listener that emits `KEEB_EV_LAYER_STATE`.
- [x] `keymap/keeb_tokens.c` — token table generated from the devicetree
      `tokens` list (`DT_FOREACH_PROP_ELEM` over `keeb,engine`), name from
      `DEVICE_DT_NAME` — the same expression ZMK's `keymap.c` uses for its own
      binding table — and the name hash cached at `SYS_INIT`. Availability is
      checked lazily with `zmk_behavior_get_binding`, so a behavior switched
      off by Kconfig is reported unavailable rather than offered.
- [x] `keymap/keeb_keymap.c` — `CELLS_GET`/`CELLS_SET`, `LAYER_NAME_SET`,
      `LAYER_ADD/REMOVE/MOVE/RESTORE`, `LAYERS_GET`, `SAVE/DISCARD/RESET`,
      `TOKEN_PARAMS` (from `behavior_get_parameter_metadata`, truncated
      responses reported), reserved-position guard. `CELLS_SET` validates every
      cell with `zmk_behavior_validate_binding` before writing any, so a batch
      is all-or-nothing; `KEEB_TOKEN_NONE` is rejected on writes.
- [ ] Split relay of layer names + art to the peripheral panel — open. The
      engine knows the names (`LAYERS_GET`), and `ui/layer_sync.c` already
      pushes art; wiring the dynamic name into that push is the remaining step.
- [ ] Host CLI over BLE (`tools/tlv-cli.mjs`) — open, and it is the next step
      before any hardware claim.
- [ ] **Acceptance:** rebind a key over BLE GATT from the CLI, persist across
      reboot, dump-and-compare round-trip equal, both halves show the right
      layer art/name — **not done**, needs hardware + the CLI above.

## Phase 2 — safety & consistency

- [x] Reserved positions come from devicetree (`reserved-positions` on
      `keeb,engine`, written as `KEEB_POS_L_TOP_0` / `KEEB_POS_R_TOP_0` = positions
      0 and 11 = the outer top corners, `&kp EQUAL` / `&kp MINUS` in the stock
      keymap). Writes to them are refused
      with `KEEB_ERR_RESERVED_POSITION` in firmware; the app cannot be trusted
      for this and does not get a vote.
- [x] Revert chord: a `zmk_position_state_changed` listener tracks how long
      *every* reserved position is held together and, after `revert-hold-ms`
      (3 s), calls `keeb_keymap_discard()`. It works on raw positions, so no
      layout — including a broken or absent one — can lock the configurator
      out. Deliberate choice **not** to pin the reserved bindings: keeping
      them owned by the keymap file means a reflashed firmware always wins,
      and the escape hatch survives precisely because it is position-based.
- [x] Validate-then-apply for the batch write (see `CELLS_SET` above); records
      in a message are otherwise applied in order, with the ACK reporting the
      first failure — documented in `proto/keeb_tlv.h` so the host never
      assumes more atomicity than exists.
- [x] Stock fallback: with `CONFIG_ZMK_STUDIO` off, ZMK's `keymap_init` does not
      wipe the RAM table, so devicetree stays the fallback and saved changes
      survive reboot (`zmk/app/src/keymap.c` settings handler). `RESET` clears
      the settings subtree through `zmk_keymap_reset_settings()`.
- [x] Notification on persist failure — `SAVE` answers with the settings-core
      error mapped to `KEEB_ERR_*`; the app shows it (`WriteResult.saveReason`
      in `app/src/stores/keymap.ts`, surfaced by `ParamPanel.vue` and
      `LayerTabs.vue`). Hardware confirmation of the NVS write is still open.
- [ ] **Acceptance:** a hostile TLV stream cannot lose the config channel or
      leave a broken partial write — the refusal paths are implemented and
      host-tested at the codec level; the full stream test needs hardware.

## Phase 3 — configurator app + wireless UX

App side as built (`app/`, now TypeScript throughout):

| plan name | actual |
|---|---|
| `app/src/proto/tlv.{js,ts}` | `app/src/proto/` — `constants.ts` (every `keeb_tlv.h` constant), `types.ts` (packed structs as interfaces), `crc32.ts`, `tlv.ts` (`TlvMessage` builder, `MessageReceiver` reassembly, `MessageSender` fragmentation) |
| device session / capabilities / keymap stores | `app/src/stores/device.ts` (transport, serial request queue, handshake, every request) and `app/src/stores/keymap.ts` (slots, ids, live model, pending edits) |
| Web Bluetooth adapter | `app/src/transport/ble.ts` behind the `KeebTransport` interface in `app/src/transport/types.ts`; `app/src/transport/mockKeyboard.ts` implements the same interface as a simulated firmware |
| `app/src/data/keycodes.js` catalog | `app/src/proto/zmk.gen.ts`, generated by `app/scripts/gen-contract.mjs` from the repo itself + the pinned ZMK checkout; `app/src/data/keycodes.ts` is the curated picker view over it |
| live grid editor on stock indices | `app/src/components/` rewritten: grid rows come from the `matrix-transform` map, caps render `{token, param1, param2}`, picker offers only tokens the handshake reported as present |

- [x] `app/src/proto/` codec mirroring the firmware. Parity is proven by
      behaviour tests (`app/tests/codec.test.ts`) plus the token-table hash the
      generated table carries — no shared fixture file, because the firmware's
      own table is the fixture.
- [x] Stores: device session, capabilities, keymap state, pending-edit diff.
      Saving is an explicit `SAVE` to the keyboard (no localStorage mirror of the
      layout); `KEEB_EV_SAVED` / `DISCARDED` keep the UI in step, and autosave
      sends that `SAVE` after each accepted write.
- [x] Autosave: applying and persisting are separate firmware operations, so a
      write that only reaches the RAM keymap is lost on reboot. The keymap store
      sends `SAVE` after every accepted `CELLS_SET` and every layer rename /
      move / add / remove; `autosave` is on by default and remembered per browser
      (`localStorage` key `keeb.autosave`), and `unsavedWrites` / `hasUnsaved`
      keep the UI honest when a SAVE is refused or autosave is off.
- [x] Web Bluetooth adapter (vendor service by UUID, write-without-response /
      notify, MTU shrink handling). **Reconnect handling is not implemented.**
- [x] Token catalogue: the generator extracts the token table, the grid
      positions, the shipped keymap and 686 named keycodes; the UI refuses to
      send a token the device reported as having no driver.
- [x] Live grid editor on stock positions, layer slots with rename / reorder /
      add / remove / restore, live read-back on every notification.
- [x] Grid drawn in the transform's **map order**, not by column number: the
      left half draws cols 0-5 (outer edge → gap), the right half draws 11-6
      (gap → outer edge), so position 6 lands beside the split and position 11 is
      the outer top-right corner — the same left-to-right reading as the keymap
      file, and the same "same local column on both halves" mirror
      `keeb-positions.dtsi` names by.
      `gridHalf()` in `app/src/stores/keymap.ts` reproduces the map, short rows
      keep their columns, unmapped grid slots render dashed, and a
      "positions" overlay prints the stock position number in every cap.
      Checked by `app/tests/grid.test.ts` (hand-written expectations from the
      board) and by the SSR smoke test (caps appear as 0..59, 12 placeholders).
- [x] Conflict detection when the firmware lacks a token (`KEEB_TOKEN_UNKNOWN`,
      greyed in the picker, refused locally before it can fail remotely).
- [x] Tests: `app/tests/codec.test.ts` (framing, CRC, reassembly, fragment
      retry), `app/tests/session.test.ts` (request/response against the
      simulated firmware), `app/tests/stores.test.ts` (store semantics),
      `npm run smoke` (SSR render of the real components). `npm run check` runs
      all of them.
- [ ] **Acceptance:** edit layout in Chrome, push over BLE, keyboard reacts
      immediately and remembers after reboot; app can be closed and reopened
      with firmware as the source of truth. Blocked on hardware: the UI has
      only ever talked to `mockKeyboard.ts`.
- [ ] Reconnect / link-loss handling in the app (the transport reports state
      changes; nothing re-dials).
- [ ] Keymap export back to `.keymap` DTS text (the UI is write-only into the
      firmware's settings store; the devicetree file stays the factory default).

## Phase 4 — live panel (done) + generic settings and images (not scheduled)

### 4a. The status screen became a host-editable model

Chosen model: **a firmware-owned widget table** (option A). Two alternatives were
considered and rejected for this keyboard:

- *host-rendered framebuffer* — simplest firmware, but a 160×68 1-bit frame is
  1360 bytes over a 46-byte notification payload, the panel only takes full-frame
  refreshes, and the screen would go blank the moment the app is closed;
- *an LVGL widget tree* — RAM pressure, and it fights the existing canvas +
  `lv_draw_sw_rotate()` + dither path that already owns the glass.

Shipped:

- [x] `keeb-module/boards/shields/keeb/ui/widget_model.{h,c}` — the table
      (≤ 24 widgets, 8 text slots, 4 value slots), presets, validation, the draw
      interpreter, and the state formatter that reads ZMK at draw time.
- [x] `panel_central.c` / `panel_peripheral.c` rewritten to interpret the table
      instead of hard-coding a layout; the shipped layout is preset 0, so the
      panel a user had is the panel the firmware starts with.
- [x] **The right half shows the connected device** — BLE profile index + 1
      (`1`, `2`, `3`…), `USB` on the cable, `--` when nothing is attached —
      relayed in `param2` of the existing `keeb,layer-art` behaviour push
      (`layer_sync.c`), the only split channel that already reaches peripherals.
- [x] `keeb-module/display/keeb_display.{h,c}` — the `DISPLAY` facade, and the
      settings subtree `keebui` (table + text slots) re-applied after
      `settings_load()`. Value slots are deliberately not persisted.
- [x] `KEEB_NS_DISPLAY` records in `proto/keeb_tlv.h` and a `handle_display()`
      dispatcher in the engine; `SYS INFO` advertises `KEEB_INFO_F_DISPLAY`.
- [x] Holding the revert chord now discards the saved keymap **and** the saved
      panel — one chord, one meaning: "forget what the app saved".
- [x] `CONFIG_KBEEB_UI_CENTRAL_ART` (default `n`) keeps the ~54 KB of artwork
      out of the central image, `CONFIG_KBEEB_UI_PERIPHERAL_PRESET` picks the
      peripheral's boot preset.
- [x] App side: `stores/display.ts`, `components/PanelEditor.vue`, widget
      catalog in `data/widgets.ts`, display codec in `proto/tlv.ts`, display
      handlers in `mockKeyboard.ts`, a `status panel` view in `App.vue`.
- [x] Tests: `app/tests/display.test.ts` — codec round-trips, the mock engine's
      refusals, and a parser that reads the **C** preset table out of
      `widget_model.c` and compares it to the mock's copy. That last check is
      what caught a preset pip row that the firmware's own validator rejected
      (`12 + 6 × (7 + 3) > 68`): a panel its own preset cannot be written back
      to is a panel that cannot be edited.

Measured cost (left / central): flash 527 804 B (65.4 %), RAM 133 036 B (50.8 %).
Right / peripheral: 468 504 B (58.1 %), RAM 102 592 B (39.1 %) — the peripheral
carries the artwork; `CONFIG_KBEEB_UI_PERIPHERAL_PRESET=1` (DEVICE only) drops
it from the image.

Still open in 4a:

- [ ] Host-driven content on the **peripheral** panel. Its table is compiled in
      and `DISPLAY` is central-only; a rich peripheral layout needs chunked
      behaviour relay, which the 16-byte behaviour-name channel does not give.
- [ ] `DISPLAY_INFO` grew by one byte (`layers`, so the editor can measure a pip
      row the way the firmware does). Verified against the mock and the host
      codec test, not against hardware.
- [ ] Nothing here has run on a real keyboard yet.

### 4b. Not scheduled

- [ ] `SETTINGS` namespace handler: idle-sleep / idle-timeout runtime value
      (needs our own watchdog or a minimal core override — decision point),
      LED pattern, screen rotation/selection.
- [ ] `IMAGE` namespace: chunked blob upload, storage partition design,
      replacing the const `gen_art.py` pipeline with a runtime image store.
      The panel namespace reserves `KEEB_NS_IMAGE`, and the 32 KB NVS settings
      store is not where images belong — a dedicated partition or a packed 1-bit
      format has to be decided first.

## Risks & mitigations

- **Layout lockout** → reserved positions + staged apply revert + stock fallback
  (Phase 2 gates Phase 3).
- **Token/firmware drift** → capability hash handshake, explicit NACK, no
  behavior name strings from the host.
- **Behavior parameters are not live-editable** — hold-tap/`hml` tuning, combos
  and conditional layers are DT nodes: the app can place them, not tune them.
  Combos stay static.
- **Core API drift on a ZMK rebase** (these APIs are Studio-facing and moving) →
  every core keymap call isolated in `keymap/mutate.c`, one file to re-audit.
- **BLE limits** (MTU, write-no-response, notification pacing) → fragmentation
  in the transport layer, never in the codec; bulk `DUMP` needs pacing tests.
- **Budget** ≈ +6 KB mutable table + pending masks, ≈ +6 KB stock copy in flash,
  plus spare layers; NVS write wear on every save. Confirm in Phase 0.
- **Split version mismatch** after a firmware flash while saved keymap survives →
  token hash must cover the layer/position count too.
- **No host connection = no config** (BLE-only): expected, recovery over BLE
  requires the keyboard to be connectable; document it in the app UI.
- **Deep sleep blanks the panel and wake is a reboot** → anything the user wants
  to keep on the screen has to be in `keebui` settings, not in RAM. Value slots
  are lost by design.
- **Panel writes are unauthenticated beyond the bond** → any bonded client can
  redraw the screen. Writes are validated per entry, the whole-table write is
  all-or-nothing, and `DISPLAY_RESET` / the revert chord are the escape hatches.

## Out of scope for this feature

ZMK Studio (its protobuf RPC, subsystem/handler linker sections, transports and
locking), USB TLV path, live editing of combos/conditional-layer/hold-tap
parameters, image upload (Phase 4b).
