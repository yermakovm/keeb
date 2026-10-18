# keeb split keyboard — ZMK workspace

One repo for everything this keyboard authors. Upstream stays outside it.

```
keyboard-zmk/                       west workspace — NOT a repo, disposable
├── .west/ zephyr/ zmk/ modules/ optional/   upstream (pinned ZMK + Zephyr 4.1
│                                            + vendor modules), never edited
├── out/                            build trees: out/left, out/right
├── env.sh                          one-line forwarder -> zmk-config/env.sh
└── zmk-config/                     THIS REPO — everything you wrote
    ├── config/                     keeb.keymap + keeb.conf   (ZMK user config)
    ├── keeb-module/                keeb shield, behaviors, bindings, status
    │                               screen, art, tools   (Zephyr module)
    ├── status-led/                 RGB status LED driver (Zephyr module)
    ├── west.yml                    manifest (ZMK only; the two modules above
    │                               are passed via -DZMK_EXTRA_MODULES)
    ├── Makefile  env.mk            build + flash entry points
    ├── env.sh                      shell env (SDK, west, ZMK_CONFIG, module paths)
    ├── build.sh                    build one half, show errors + memory usage
    ├── docs/                       presentation deck (Marp slides, Ukrainian),
    │                               theme/keeb.css, build.mjs (merges <n>_*.md
    │                               into one deck), assets/
    └── package.json                deck toolchain (marp-cli devDependency)
```

`keeb-module/` and `status-led/` were folded in with `git subtree add`, so their
original commit history is in this repo's history — they are not copies.

## Build

```sh
make -C zmk-config left        # -> out/left
make -C zmk-config right       # -> out/right
```

Or `./build.sh left|right` from this directory (same build, prints only errors
and the memory-usage table). A raw `west build` works too:

```sh
source zmk-config/env.sh
west build -s zmk/app -b xiao_ble//zmk -d out/left -- \
     -DSHIELD=keeb_left -DZMK_CONFIG="$ZMK_CONFIG" \
     -DZMK_EXTRA_MODULES="$KEEB_MODULE;$STATUS_LED"
```

**After any Kconfig/devicetree change in `keeb-module/` or `status-led/`, and always
after changing `BOARD`, `ZMK_CONFIG` or a module path, run `make clean` (or
`rm -rf out/<side>`).** Incremental rebuilds reuse stale config silently, and
ZMK warns about it directly: *"The build directory must be cleaned pristinely
when changing user ZMK config"* (`zmk/app/keymap-module/modules.cmake`).

## Flash (UF2)

```sh
make -C zmk-config flash-right     # or flash-left
```

One half connected at a time, and it must be in the bootloader first: both
halves mount the same `XIAO-SENSE` drive. Enter it by chord (`MINUS`+`7` =
right, `PLUS`+`2` = left, hold `MINUS`+`6`/`PLUS`+`1` to just reboot) or by
double-tapping RESET. Equivalent manual copy:

```sh
cp out/left/zephyr/zmk.uf2  /Volumes/XIAO-SENSE/
cp out/right/zephyr/zmk.uf2 /Volumes/XIAO-SENSE/
```

Console: `make -C zmk-config monitor` (`screen /dev/cu.usbmodem* 115200`,
needs `CONFIG_ZMK_USB_LOGGING=y` in `config/keeb.conf`).

## Where things live

| to change… | edit |
|---|---|
| keymap, layers, combos, Kconfig of the build | `config/keeb.keymap`, `config/keeb.conf` |
| matrix wiring, shields, battery sense, display, behavior nodes | `keeb-module/boards/shields/keeb/keeb.dtsi`, `keeb_{left,right}.overlay`, `keeb_{left,right}.conf` |
| a behavior (e.g. right-half reboot forwarding) | `keeb-module/boards/shields/keeb/behavior_*.c` + `keeb-module/dts/bindings/behaviors/*.yaml` |
| status screen panels | `keeb-module/boards/shields/keeb/ui/` |
| live keymap engine (TLV protocol, dispatcher, BLE channel) | `keeb-module/proto/`, `keeb-module/engine/`, `keeb-module/keymap/keeb_tokens.c`, `keeb-module/keymap/keeb_keymap.c`, `keeb-module/transport/keeb_ble.c`, `keeb-module/dts/bindings/keeb,engine.yaml` |
| LED boot/connect/advertise pattern | `status-led/` |

Per-side Kconfig defaults for the shield (`CONFIG_ZMK_SLEEP`, the Adafruit
boot-mode magic, LVGL sizing) belong in `keeb-module/boards/shields/keeb/keeb_{left,right}.conf`;
`config/keeb.conf` holds the user-level overrides shared by both halves.

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
`CONFIG_BT_L2CAP_TX_MTU - 3`, so a 700-byte keymap dump travels as twelve 62-byte
notifications. Records are applied in order, and the reply carries an ACK record
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

**Escape hatch.** `reserved-positions` on the `keeb,engine` node (currently
positions 0 and 11, the outer top corners: `&kp PLUS` / `&kp MINUS`) are refused
by the engine (`KEEB_ERR_RESERVED_POSITION`), so a layout from the configurator
can never take away the revert chord. Holding *all* reserved positions for
`revert-hold-ms` (3 s) discards the saved keymap and falls back to the keymap
file. It is detected on raw key positions, so no layout — and no broken or
missing layout — can lock the configurator out. Persistence is ZMK's own:
`SAVE` / `DISCARD` / `RESET` go to `zmk_keymap_save_changes()`,
`zmk_keymap_discard_changes()`, `zmk_keymap_reset_settings()`.

**Central-only by design** (`CONFIG_KBEEB_ENGINE depends on !ZMK_SPLIT ||
ZMK_SPLIT_ROLE_CENTRAL`): ZMK resolves bindings on the central and sends the
resolved binding to the peripheral, so the peripheral executes whatever the
central's layout says, and it holds no host connection anyway. The right half
builds without a single engine symbol.

```sh
make -C zmk-config tlv-test    # codec + fragmenter on the host, no keyboard
```

`tools/tlv_test.sh` compiles `proto/keeb_tlv.c` with `-Wall -Wextra -Werror`
and runs it against itself through a fake link: wire-layout offsets, CRC
check-values, build/iterate round-trips, torn-record rejection, an 84-check
loopback (clean 700-byte send, MTU-shrink retry, busy retry, dropped fragment
then restart, corrupted byte, and every malformed-header path).

**Verified:** codec host tests green; both halves build (left = central with the
engine: 523128 B flash / 131884 B RAM; right = peripheral: 408512 B / 101952 B,
i.e. the engine's footprint is central-side only). **Not yet verified:** anything
requiring hardware — BLE pairing with the channel, an actual rebind over the
air, persistence across reboot. `docs/tasks.md` tracks the remaining phases
(host CLI over BLE, split relay of layer names, the configurator app).

## Status screen

ZMK's built-in status screen is replaced by the keeb panels
(`CONFIG_ZMK_DISPLAY_STATUS_SCREEN_CUSTOM`, code in
`keeb-module/boards/shields/keeb/ui/`):

- **left (central)**: layer number + name + position pips, battery of both
  halves, link/host/charging state. Everything is read from ZMK at draw time;
  only the right half's battery is cached (the central fetches the peripheral's
  Battery Service level and republishes it as
  `zmk_peripheral_battery_state_changed`, which is why
  `CONFIG_ZMK_BATTERY_REPORTING=y` and
  `CONFIG_ZMK_SPLIT_BLE_CENTRAL_BATTERY_LEVEL_FETCHING=y` must stay on).
- **right (peripheral)**: fixed rounded frame, only the layer artwork changes.
  No battery, no link state — the left half owns all readouts.

Both are 160x68 1-bit panels drawn into an L8 canvas that LVGL dithers to the
panel (same trick as ZMK's nice!view custom screen).

**Rotation**: the UI is laid out in the viewing orientation and rotated with
`lv_draw_sw_rotate()` before it reaches the framebuffer. Pick it in Kconfig
(`KBEEB_UI_ROTATION_{0,90,180,270}`, default 0 = landscape). 90/270 lay out a
68x160 portrait UI and switch the artwork to the portrait set.

**Layer artwork**: `keeb-module/art/<layer>.png`, one per layer, in keymap order
(`home, navigation, function, media, game`). White line art on black —
bright pixels become ink. Then:

```sh
python3 keeb-module/tools/gen_art.py   # needs Pillow
```

It writes `ui/art/layer_art_data.c` + `layer_art_count.h` (commit those; they
are generated, not hand-edited). Missing files become labelled placeholders so
the build never breaks. Optional `<layer>_portrait.png` overrides the portrait
variant. Art is stored as A8 stencils and blended in the current ink colour,
so `CONFIG_ZMK_DISPLAY_INVERT` flips frame, text and art together.

Portrait art usually comes from a mockup sheet (one PNG, every panel framed).
`tools/crop_panels.py <mockup>.png` cuts the artwork out of each panel — it
drops the mockup's own frame (the firmware draws its own) and the decorative
battery glyph (the left half owns the battery readouts), then writes
`art/<layer>_portrait.png` for `gen_art.py` (`--measure` prints component
boxes when the sheet layout changes, `--keep-battery` leaves the glyph in):

```sh
python3 keeb-module/tools/crop_panels.py mockup.png   # needs Pillow + numpy
python3 keeb-module/tools/gen_art.py
```

**How the right half learns the layer**: ZMK does not replicate layer state to
peripherals, so the central invokes the `keeb,layer-art` behaviour (global
locality — ZMK forwards it to every peripheral) from a layer-change listener,
and re-sends it when a peripheral connects (polled every
`KBEEB_UI_LAYER_SYNC_POLL_MS`, since ZMK raises no central-side connect event).
The behaviour node is named `la` on purpose: a behaviour's device name is its
node name.

## Presentation deck (docs/)

`docs/<n>_*.md` are Marp slides (Ukrainian, one topic per file); `docs/theme/keeb.css` is
the deck theme (dark palette, 16:9 1280x720). Marp CLI is a devDependency, so there is
nothing global to install:

```sh
npm run deck        # -> docs/dist/deck.html + deck.pdf
npm run deck:html   # HTML only (self-contained, presents offline)
npm run deck:pdf    # PDF only
npm run preview     # live preview of the title slide
```

`docs/build.mjs` does the work: it concatenates `docs/<n>_*.md` sorted **numerically**
(lexicographic order puts `10_sw_demo.md` before `1_project_idea.md`, and `&` in the file
names is a shell pain) into `docs/.deck.md`, then converts once — Marp CLI refuses `-o`
with several input files, so a merged document is the only way to build one deck out of
eleven files. PDF/PPTX export renders through an installed browser (Marp finds Chrome on
its own; pass `--browser-path` if it does not).

Consequences when writing slides:

- Only `0_index.md` carries front-matter, and that config is **deck-wide** (`marp`,
  `title`, `lang`, `theme`) because that is where the merged document starts.
- Per-slide settings go into an HTML comment with the `_` prefix (`<!-- _class: agenda -->`).
  Without the underscore the directive leaks to every following slide.
- Assets live in `docs/assets/` and are referenced as `assets/<file>` (paths resolve
  against `docs/`). Marp blocks local files during export unless `--allow-local-files`
  is given — `build.mjs` passes it.
- Title slide: text left, image right via `![bg right:45% contain](...)`. The placeholder
  `docs/assets/keyboard-placeholder.svg` is 480:600 — exactly the right half of a 16:9
  slide, so `contain` fills it. Replace it with `docs/assets/keyboard.png` and use `cover`
  to crop a real photo. `![bg left:45% contain](...)` plus `_class: title flip` mirrors
  the layout.

`docs/dist/` and `docs/.deck.md` are generated, not hand-edited (gitignored).

## Workspace rebuild notes

- The workspace itself is disposable: `west init -l zmk-config && west update`
  re-creates `zephyr/`, `zmk/`, `modules/`, `optional/`. Nothing of yours is in
  them.
- `EXTRA_ZEPHYR_MODULES` must stay unset (it replaces ZMK's own module list on
  Zephyr 4.1 and silently drops `zmk/app/module`) — `env.sh`/`Makefile` unset it
  for you.
- If `modules/` ever contains a leftover copy of `keeb*` or `zmk-status-led`
  from the pre-migration west project, delete it: with the modules now inside
  this repo there must be exactly one copy of each.
