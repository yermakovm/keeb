# keeb split keyboard

This repo is the keyboard's authored code (keymap, shield, drivers, web UI).
It lives inside a Zephyr workspace; upstream (ZMK + Zephyr + vendor HALs) is
downloaded by `west` into the workspace root, never into this repo.

```
keyboard-zmk/                        west workspace root (not a git repo)
├── .west/config                     manifest.path = zmk-config
├── zephyr/                          west project (not in git)
├── zmk/                             west project (not in git)
├── modules/                         west projects (not in git)
├── optional/                        west projects (not in git)
├── out/                             build trees: out/left, out/right
└── zmk-config/                      THIS REPO
    ├── config/                      keeb.keymap + keeb.conf   (ZMK user config)
    ├── keeb-module/                 keeb shield, behaviors, bindings, status
    │                                screen, art, tools   (Zephyr module)
    ├── status-led/                  RGB status LED driver (Zephyr module)
    ├── buzzer/                      active buzzer driver + behavior (Zephyr module)
    ├── west.yml                     manifest (ZMK; local modules via ZMK_EXTRA_MODULES)
    ├── Makefile  env.mk             build + flash entry points
    ├── env.sh                       shell env (SDK, west, ZMK_CONFIG, module paths)
    ├── build.sh                     build one half, show errors + memory usage
    ├── docs/                        presentation deck (Marp slides, Ukrainian),
    │                                theme/keeb.css, build.mjs (merges <n>_*.md
    │                                into one deck), assets/
    └── package.json                 deck toolchain (marp-cli devDependency)
```

## Build

```sh
make -C zmk-config left        # -> out/left
make -C zmk-config right       # -> out/right
```
Or `./build.sh left|right` from this directory (same build, prints only errors
and the memory-usage table). A raw `west build` works too:

```sh
source zmk-config/env.sh
west build -s zmk/app -b nice_nano@2.0.0//zmk -d out/left -- \
     -DSHIELD=keeb_left -DZMK_CONFIG="$ZMK_CONFIG" \
     -DZMK_EXTRA_MODULES="$KEEB_MODULE;$STATUS_LED;$BUZZER"
```

## Flash (UF2)

```sh
make -C zmk-config flash-right     # or flash-left
```
## Live keymap engine (KEEB TLV over BLE GATT)

The keyboard accepts a binary config channel over BLE GATT and rebinds keys,
renames/reorders/adds/removes layers and persists the result — written from
scratch. **ZMK Studio is not used**: its protobuf RPC, subsystem/handler linker
sections, transports and locking are not enabled and not compiled. What is
reused is ZMK's *core* dynamic keymap (`CONFIG_ZMK_KEYMAP_SETTINGS_STORAGE`,
`CONFIG_ZMK_KEYMAP_LAYER_REORDERING`) — the same options Studio merely selects,
which is what makes this the same feature without Studio.

Engine code lives in `keeb-module/`:

```
proto/keeb_tlv.h|.c          packet header + record codec, fragmentation,
                             reassembly, CRC-32/IEEE. Plain C, no Zephyr
                             headers, so the host test links the same file
engine/keeb_engine.c         dispatcher: one RX slot, one work item, reply =
                             ACK record + response records, notify queue
keymap/keeb_tokens.c         token table generated from devicetree, name hash
keymap/keeb_keymap.c         the ONLY file allowed to call ZMK's keymap core
transport/keeb_ble.c         vendor GATT service (write/notify), MTU-aware
```

`keymap/keeb_keymap.c` being the single ZMK-core entry point is deliberate:
after a ZMK rebase, that is the one file to re-audit.

**Wire format.** 16-byte little-endian packet header
(`magic | version | flags | msg_id | frag_off | frag_len | msg_len | crc32`),
payload = records of `type(u16) | len(u16) | value`. A message is up to
`KEEB_TLV_MSG_MAX` (1024 B) bytes and is fragmented by the sender to
`CONFIG_BT_L2CAP_TX_MTU - 3 - 16` (46 B: the ATT opcode and handle, and the
packet header itself, all of which live inside the notification), so a 700-byte
keymap dump travels as sixteen notifications. The peer's real MTU is checked per
connection before a fragment is handed to `bt_gatt_notify`, because Zephyr
reports an oversized PDU as `-ENOMEM` - the same code an empty TX pool gives,
and the wrong reason to retry the same bytes. Records are applied in order, and the reply carries an ACK record
as record 0 plus the response records; a failure in one record is reported as
the ACK code while earlier records stay applied — only `CELLS_SET` is
all-or-nothing (validate every cell with `zmk_behavior_validate_binding` first,
then write), so no half-accepted layout can arrive. Reassembly requires
in-order offsets: a gap makes the receiver refuse with `KEEB_ERR_BAD_SEQ` and
the sender restarts the message with `KEEB_PKT_F_FIRST`, which keeps the
receiver stateless about losses. A reply that never arrives means the host
restarts the message.

**Tokens.** A binding cannot be named by string alone (`zmk_behavior_get_binding`
resolves device names that exist in the image), so the protocol references
*tokens*: the devicetree `tokens` list on the `keeb,engine` node, id = index in
that list. The engine reports the table plus a CRC-32 over
`u16 id | name | 0x00` per token, and the host must echo that hash before any
write is accepted — host and firmware can never silently disagree about what a
token means. Behaviors whose driver was dropped by Kconfig stay in devicetree
and are reported as unavailable, so a write can never be answered with a token
the firmware cannot execute.

**Escape hatch.** `reserved-positions` on the `keeb,engine` node (`KEEB_POS_L_TOP_0`
and `KEEB_POS_R_TOP_0` in `keeb-module/dts/keeb-positions.dtsi` — positions 0 and 11,
the outer top corners, `&kp EQUAL` / `&kp MINUS` in the stock keymap) are refused
by the engine (`KEEB_ERR_RESERVED_POSITION`), so a layout from the configurator
can never take away the revert chord. Holding *all* reserved positions for
`revert-hold-ms` (3 s) runs `keeb_keymap_discard()`, i.e. ZMK's
`zmk_keymap_discard_changes()`: unsaved changes are dropped and the keyboard
returns to its saved overlay (the keymap file when nothing is saved). It is
detected on raw key positions, so no layout — and no broken or missing layout —
can lock the configurator out. Clearing a *saved* layout without the app needs
`keeb_keymap_reset()`, which the chord does not call today.
Persistence is ZMK's own:
`SAVE` / `DISCARD` / `RESET` go to `zmk_keymap_save_changes()`,
`zmk_keymap_discard_changes()`, `zmk_keymap_reset_settings()`.

**Central-only by design** (`CONFIG_KBEEB_ENGINE depends on !ZMK_SPLIT ||
ZMK_SPLIT_ROLE_CENTRAL`): ZMK resolves bindings on the central and sends the
resolved binding to the peripheral, so the peripheral executes whatever the
central's layout says, and it holds no host connection anyway. The right half
builds without a single engine symbol.

## Editing the panel from the app

The live configurator (`app/`) edits this table over the same KEEB TLV channel
as the keymap, in the `DISPLAY` namespace that the protocol reserved from the
start:

| record | what it does |
|---|---|
| `DISPLAY_INFO` | the real limits: widget count, slot count, slot length, kind/source range, logical vs panel size, rotation, `sizeof(keeb_widget)`, layer count, whether artwork is drawable |
| `PRESET_NAME` | one per preset, so the picker is built from the keyboard |
| `DISPLAY_GET` → `DISPLAY` | the table, then the text slots and value slots as their own records |
| `DISPLAY_SET` | replace the whole table (validated as a unit: nothing is drawn if one entry is bad) |
| `WIDGET_SET` | replace or append one entry |
| `TEXT_SET` / `VALUE_SET` | write a host-owned slot |
| `PRESET_SET` | restore a compiled-in preset, including its own text |
| `DISPLAY_SAVE` / `DISPLAY_DISCARD` / `DISPLAY_RESET` | persist / revert / delete the saved panel |
| `DISPLAY_BLANK` | clear the glass once, on the next paint |

Applying and persisting stay two operations, exactly as in the keymap: a
`DISPLAY_SET` redraws the panel now, and only `DISPLAY_SAVE` survives a reboot
or a deep sleep. `SYS INFO` advertises `KEEB_INFO_F_DISPLAY` so a configurator
can tell a panel-capable build from one that is not.

Image upload (`KEEB_NS_IMAGE`) is still unimplemented: the panel today selects
compiled-in artwork, it does not receive bitmaps.

## Presentation deck (docs/)

`docs/<n>_*.md` are Marp slides; `docs/theme/keeb.css` is
the deck theme (dark palette, 16:9 1280x720). Marp CLI is a devDependency, so there is
nothing global to install:

```sh
npm run deck        # -> docs/dist/deck.html + deck.pdf
npm run deck:html   # HTML only (self-contained, presents offline)
npm run deck:pdf    # PDF only
npm run preview     # live preview of the title slide
