# keeb — pinout

Split keyboard on **nice!nano** boards (`BOARD = nice_nano@1.0.0//zmk`, Pro Micro
footprint). Both halves wire identically; the right half only shifts its local
columns into the shared keymap with `col-offset = <6>` (`keeb_right.overlay`).

There is **no I2C and no matrix expander**: 12 matrix pins, 3 display pins and 3
RGB pins are direct nRF52840 GPIOs. That is 18 pins — every GPIO on a Pro Micro
header, so there is no spare **header** pin left. The MCP23017 (`i2c1`, addr `0x20`)
is gone. The buzzer (left half) sits on **P1.01**, which is not a header pin at
all — see [Buzzer](#buzzer-left-half-ky-006-passive-piezo).

Wiring lives in `boards/shields/keeb/keeb.dtsi` (shared) and
`boards/shields/keeb/keeb_left.overlay` (left-half-only parts). The nRF pin numbers
below are the ones to trust; D-labels are ZMK's nice!nano mapping (`&pro_micro <n>`)
and clone silkscreens vary.

## Matrix

Diodes conduct **col → row** (anode on the col side) → `diode-direction = "col2row"`.
Rows are inputs with the nRF's internal pull-downs, active-high, and carry the
`wakeup-source` wake-from-sleep interrupts. Cols are outputs, active-high; while
idle the driver parks all of them HIGH, so a press pulls a row HIGH.

| Pro Micro | nRF pin   | Use          | Notes                                              |
| --------- | --------- | ------------ | -------------------------------------------------- |
| D0        | P0.08     | Matrix row 0 | was `uart0` RX (uart0 disabled)                    |
| D4/A6     | P0.22     | Matrix row 1 |                                                    |
| D5        | P0.24     | Matrix row 2 |                                                    |
| D6/A7     | P1.00     | Matrix row 3 |                                                    |
| D7        | P0.11     | Matrix row 4 |                                                    |
| D8/A8     | P1.04     | Matrix row 5 |                                                    |
| D9/A9     | P1.06     | Matrix col 0 | output                                             |
| D10/A10   | P0.09     | Matrix col 1 | output                                             |
| D16       | P0.10     | Matrix col 2 | output (was `spi1` MOSI on nice!nano)              |
| D14       | P1.11     | Matrix col 3 | output (was `spi1` MISO on nice!nano)              |
| D15       | P1.13     | Matrix col 4 | output                                             |
| D18/A0    | P1.15     | Matrix col 5 | output                                             |

`spi1` is left disabled so the board's `spi1` pinctrl never claims P1.13/P0.10/P1.11
back from the matrix.

## nice!view (SPI, write-only)

Same pins ZMK's own `nice_view_adapter` ships for nice!nano: SPIM0 on the pins
that used to be the OLED's I2C pair, CS on the top-left header pin.

| Pro Micro | nRF pin | Use              | Notes                                       |
| --------- | ------- | ---------------- | ------------------------------------------- |
| D3        | P0.20   | SPI SCK          | `&spi0` (`&nice_view_spi`)                  |
| D2        | P0.17   | SPI MOSI         | `&spi0`                                     |
| D1        | P0.06   | SPI CS           | active-high (LS0xx `XS`), was `uart0` TX    |
| —         | P0.25   | SPI MISO         | not on the header; carried only because the panel is write-only |

`&i2c0` is disabled: its pinctrl is the SCK/MOSI pair above.

## Status RGB (KY-016 module)

Common cathode, module pin `−` to GND, 150 Ω per channel already on the module.

| Pro Micro | nRF pin | Use                                       |
| --------- | ------- | ----------------------------------------- |
| D19/A1    | P0.02   | R — `&pwm1` channel 0 (`NRF_PSEL(PWM_OUT0, 0, 2)`)  |
| D20/A2    | P0.29   | G — `&pwm1` channel 1 (`NRF_PSEL(PWM_OUT1, 0, 29)`) |
| D21/A3    | P0.31   | B — `&pwm1` channel 2 (`NRF_PSEL(PWM_OUT2, 0, 31)`) |

Declared as `pwm-leds` in `keeb.dtsi`, i.e. hardware PWM outputs, so the whole
palette can run at a duty cycle: `CONFIG_ZMK_STATUS_LED_BRIGHTNESS_PERCENT`
(default 50, in `config/keeb.conf`) is how bright every lit signal is. On the
nRF52840 any pad can be a PWM output — the peripheral routes it through PSEL —
so this is a devicetree change, not a rewiring.

Why `&pwm1` and not the `&pwm0` the buzzer uses: all channels of one nRF52 PWM
instance share one period, and the buzzer retunes its period for every tone
(the pitch *is* the period). Sharing an instance would retune the LEDs with
each beep. Driver + Kconfig in [`status-led/`](../status-led/README.md).

These are SoC outputs, and the SoC keeps its output state through System OFF —
a channel left driven would keep burning its LED while the half sleeps.
`zmk-status-led` drives all three to 0% on the SLEEP activity state, which ZMK
raises before it powers down, and the `status_led_pwm_sleep` pinctrl state
disconnects the pads behind it (the nrfx PWM driver requires default + sleep
states, same as the buzzer's).

## Buzzer (left half, KY-006 passive piezo)

**KY-006** (also sold as **HW-508**): a passive piezo module — no onboard
oscillator, so a static HIGH is silence and the drive **frequency is the pitch**
(usable ~1.5–2.5 kHz, loudest at its ~2 kHz resonance). That makes P1.01 a PWM
output, not a GPIO: `&pwm0` is enabled in `keeb_left.overlay` and its channel 0
is routed to P1.01 by `NRF_PSEL(PWM_OUT0, 1, 1)`. Driver + behavior in
[`buzzer/`](../buzzer/README.md), enabled by `CONFIG_ZMK_BUZZER=y` in
`config/keeb.conf`.

| nRF pin | Use                | Notes                                                    |
| ------- | ------------------ | -------------------------------------------------------- |
| P1.01   | Buzzer signal (S)  | **left half only**; `&pwm0` channel 0 (`PWM_OUT0`), 50 % duty |

What it sounds like, and where each one is set:

| Event | Sound | Set by |
| ----- | ----- | ------ |
| Entering / leaving **GAME** | two rising notes / the same two upside down | `beep-layers = <KEEB_LAYER_GAME>` in `keeb_left.overlay` |
| `left_reset_combo` | random rhythm and pitch | `&buzzer_reset` (`tune` unset = `random`) in `keeb.dtsi` |
| `left_boot_combo` | three falling notes | `&buzzer_boot` (`tune = "bootloader"`) in `keeb.dtsi` |
| Update accepted / refused over the TLV engine | short rising ding / two low thuds | `keeb_engine.c`, chosen from the same ACK the configurator gets |
| Wake from ZMK sleep | brief two-step | `beep-on-wake` in `keeb_left.overlay` |

Shapes and lengths are in [`buzzer/README.md` — Tunes](../buzzer/README.md#tunes).
The layer and wake sounds are properties of the buzzer node rather than keymap
bindings, so they fire however the event happens; the two chords need a behavior
node because a combo carries one binding and both `&sys_reset` and `&bootloader`
reboot inside their own callback.

Left half only: it is the half the chords are played on and the half they reboot,
and it is the half the disc is soldered to. `&pwm0` stays disabled and there is no
`zmk,buzzer` node on the right half, so the buzzer behavior there runs its action
with no sound (`-ENODEV` → act immediately). `&buzzer_reset` and `&buzzer_boot`
live in `keeb.dtsi` because the shared `config/keeb.keymap` references them on
both halves; a phandle to a node that does not exist is a build error.

Wiring is two wires: module **S** → P1.01, module **−** → GND (the middle pin is
NC on these boards). No transistor: a piezo is a small capacitive load, which is
exactly what the previous TMB12A03 active buzzer was not — that design needed a
2N7002 stage for its ~30 mA coil and is gone. Silence is 0 % duty, so the same
System-OFF caveat as the RGB applies: the driver parks the output at 0 % on the
SLEEP activity state and the `&pwm0` node carries a `sleep` pinctrl state
(`low-power-enable`) that disconnects the pad, because the SoC keeps pad state
through System OFF.

## Not on the header

| nRF pin | Use       | Notes                                                          |
| ------- | --------- | -------------------------------------------------------------- |
| P0.04   | Battery   | AIN2 → `&vbatt`. nice!nano's battery pad: "can't be used for any other function" |
| P0.25   | SPI MISO  | see the display table                                          |
| P0.13   | EXT_POWER | nice!nano's VCC cut-off (driven by the board's `EXT_POWER` node, see below) |
| P0.15   | Blue LED  | on-board                                         |
| P0.18   | RESET     | on-board                                         |
| P1.01   | Buzzer    | **left half only** — see the buzzer section                     |

### P0.13 / VCC (why the board revision is `@2.0.0`)

nice!nano switches the **VCC** rail — the 3 V supply the nice!view and the KY-016
are wired to — from P0.13, and the two board revisions invert the devicetree
polarity:

| revision | `EXT_POWER` control-gpios | ZMK enables ext-power at boot → P0.13 |
| --- | --- | --- |
| 1.0.0 | `GPIO_ACTIVE_LOW`  | **low**  → VCC on |
| 2.0.0 | `GPIO_ACTIVE_HIGH` | **high** → VCC on (inverted switch vs v1) |

ZMK's `ext_power_generic` driver defaults to *enabled* on first boot (no stored
setting), so the level is decided by the revision, not by the keymap (`&ext_power`
is unused here).

**These boards are the active-high kind**: the board manual says P0.13 high turns
VCC on. So the Makefile builds `nice_nano@2.0.0//zmk`. Building them with
`@1.0.0` drives P0.13 low, cuts VCC, and the display and the RGB module simply
stay dark — which is exactly what was measured (no 3.3 V on VCC) before the
switch. Confirm in the built tree:

```sh
grep -A2 'EXT_POWER {' out/left/zephyr/zephyr.dts   # 0x0 = ACTIVE_HIGH, 0x1 = ACTIVE_LOW
```

The one @1.0.0 trait that mattered was the battery divider (P0.04, 2 MΩ / 806 kΩ)
— these boards do not have it, which is why `&vbatt` is already
`zmk,battery-nrf-vddh` in `keeb.dtsi`. A genuine v1 board would need the divider
compatible *and* the 1.0.0 revision, changed together.

## Battery sense

`&vbatt` = `zmk,battery-nrf-vddh` in `keeb.dtsi`: the clone boards have no
divider on P0.04/AIN2, so the level comes from the VDDH rail directly and the
ADC is not involved. (`nice_nano@2.0.0` declares the same compatible; the shield
states it so the choice lives next to the wiring it belongs to.) If a board
does measure a divider, switch `compatible` to `zmk,battery-voltage-divider`
with `io-channels = <&adc 2>` and the measured `output-ohms` / `full-ohms`, and
build that board with `nice_nano@1.0.0//zmk`.

## Power mode

`keeb.dtsi` forces both regulator stages to LDO — `&reg0` disabled,
`&reg1` `regulator-initial-mode = <NRF5X_REG_MODE_LDO>` — and
`keeb-module/Kconfig` defaults `KBEEB_POWER_FORCE_LDO=y` (applied at boot by
`boards/shields/keeb/power.c`), because these boards are missing the buck
inductors and DCDC mode does not regulate on them. The devicetree half is not
redundant: `@2.0.0` re-enables `&reg0`, and soc.c would set DCDCEN0 from that
before `power.c` runs. On a board you trust, set `CONFIG_KBEEB_POWER_DIAG=n`
and delete the `&reg0` / `&reg1` overrides.

## Removed with the board change

| Was                          | Now                                            |
| ---------------------------- | ---------------------------------------------- |
| MCP23017 on `i2c1` (`0x20`)  | nothing — direct GPIOs                         |
| Rows on SoC, cols on expander| rows **and** cols on the SoC                   |
| RGB on expander GPB5–GPB7    | D19/D20/D21 (`P0.02` / `P0.29` / `P0.31`)      |
| Display on `&xiao_spi` (`spi2`), CS P1.12 | `&spi0`, CS P0.06            |
| `CONFIG_I2C=y`, `CONFIG_GPIO_MCP230XX=y` | dropped from both `.conf` files |
