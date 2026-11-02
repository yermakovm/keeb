# zmk-status-led

Three-channel (RGB) status LED for ZMK keyboards. Pure devicetree +
Kconfig — no keymap changes needed.

Channels are Zephyr LED devices, referenced by phandle: a `pwm-leds` child
(an SoC PWM pad) or a `gpio-leds` child (plain SoC GPIO, or a GPIO expander
e.g. MCP23017 over I2C). The driver code is the same either way — it asks for
a brightness percentage per channel and Zephyr's LED driver turns that into a
pulse width or a pin state. `pwm-leds` channels are dimmable, `gpio-leds`
channels are on/off and ignore the brightness setting (the driver logs that
once at boot instead of pretending).

On keeb the three channels are `pwm-leds` on `&pwm1` (P0.02 / P0.29 /
P0.31 — see [keeb](../keeb-module/readme.md)).

NB for SoC pads: the nRF52840 keeps its pad state through System OFF, so a
channel left driven keeps burning its LED while the half "sleeps". This driver
drives all three to 0% on the SLEEP activity state, which ZMK raises before
powering down — keep that if you patch the driver. For `pwm-leds` channels the
controller also needs a `sleep` pinctrl state with `low-power-enable` (the
nrfx PWM driver requires default + sleep states at all), which drops the pads
on a PM suspend.

## Palette (priority order)

Every lit signal below runs at `ZMK_STATUS_LED_BRIGHTNESS_PERCENT` (default
50%), so the palette keeps its proportions while the whole thing dims together.

| State | Pattern | Trigger |
|---|---|---|
| Error | solid **red** | battery <= `ZMK_STATUS_LED_BATTERY_ERROR_LEVEL` (latched, clears at threshold +5%) |
| Layer | solid **red/green/blue** | keyboard calls `zmk_status_led_set_layer_color()` (e.g. non-home layer indication, see [keeb](../keeb-module)) |
| Connected | one 150 ms **green** flash | BLE profile connected (also on profile switch) |
| Advertising | 100 ms **blue** pulse every 2 s | BLE disconnected / not connected |
| Boot | `ZMK_STATUS_LED_BOOT_BLINKS` quick **white** blinks | startup, then transitions to the state above |
| Off | off | default; LED also off when the keyboard sleeps |

Error state has priority over everything until the battery recovers; the
Layer state overrides Connected/Advertising while active (the color is
latched during sleep and boot blinks, applied when those end).
Note: if the channels run from a 3.0–3.3 V rail, green/blue (Vf ≈ 2.8 V)
stay dim relative to red (Vf ≈ 1.8 V) — the palette is red-dominant by
physics, and that is fine for a status indicator.

Works on split centrals and peripherals (peripherals track their
connection to the central).

## Installation

`zmk-config/config/west.yml`:

```yaml
manifest:
  remotes:
    - name: zmkfirmware
      url-base: https://github.com/zmkfirmware
    - name: local-keyboard            # or a git remote after pushing this repo
      url-base: file:///path/to/keyboard/firmware
  projects:
    - name: zmk
      remote: zmkfirmware
      revision: main
      import: app/west.yml
    - name: zmk-status-led
      remote: local-keyboard
      path: modules/zmk-status-led
  self:
    path: config
```

## Devicetree (board/shield overlay)

Dimmable (recommended: three PWM outputs on one instance):

```dts
#include <dt-bindings/pwm/pwm.h>

/ {
    leds {
        compatible = "pwm-leds";
        /* Example: KY-016 RGB module on three SoC pads (module pin "-" is
         * the common cathode -> GND). On keeb these are D19/D20/D21. */
        led_r: led_r { pwms = <&pwm1 0 PWM_USEC(2000) PWM_POLARITY_NORMAL>; };
        led_g: led_g { pwms = <&pwm1 1 PWM_USEC(2000) PWM_POLARITY_NORMAL>; };
        led_b: led_b { pwms = <&pwm1 2 PWM_USEC(2000) PWM_POLARITY_NORMAL>; };
    };

    status_led_device: status_led_device {
        compatible = "zmk,status-led";
        led-r = <&led_r>;
        led-g = <&led_g>;
        led-b = <&led_b>;
    };
};

/* Mandatory for the nRF52 PWM driver: its outputs reach the pads through
 * PSEL, not fixed pins, so it needs default + sleep pinctrl states. */
&pinctrl {
    status_led_pwm_default: status_led_pwm_default {
        group1 {
            psels = <NRF_PSEL(PWM_OUT0, 0, 2)>,
                    <NRF_PSEL(PWM_OUT1, 0, 29)>,
                    <NRF_PSEL(PWM_OUT2, 0, 31)>;
        };
    };
    status_led_pwm_sleep: status_led_pwm_sleep {
        group1 {
            psels = <NRF_PSEL(PWM_OUT0, 0, 2)>,
                    <NRF_PSEL(PWM_OUT1, 0, 29)>,
                    <NRF_PSEL(PWM_OUT2, 0, 31)>;
            low-power-enable;
        };
    };
};

&pwm1 {
    status = "okay";
    pinctrl-0 = <&status_led_pwm_default>;
    pinctrl-1 = <&status_led_pwm_sleep>;
    pinctrl-names = "default", "sleep";
};
```

Notes on the PWM form:

* Put all three channels on **one** instance: the nRF52 PWM peripheral has
  three output channels and they share a single period.
* Keep that instance away from anything else that changes its period. On keeb
  the buzzer owns `&pwm0` and retunes it per tone (the pitch *is* the period),
  so the LEDs use `&pwm1`.
* 2 ms (500 Hz) is a safe period: no visible flicker, and 32000 counts at the
  16 MHz peripheral clock fits COUNTERTOP without a prescaler, so each 1%
  brightness step is exact.
* 0% and 100% do not need the peripheral at all — the PWM driver writes the pad
  and stops, so only a dimmed channel keeps it running.

On/off only (plain GPIO or an expander) — works, but the brightness setting is
ignored:

```dts
/ {
    leds {
        compatible = "gpio-leds";
        led_r: led_r { gpios = <&mcp23017_0 5 GPIO_ACTIVE_HIGH>; };
        led_g: led_g { gpios = <&mcp23017_0 6 GPIO_ACTIVE_HIGH>; };
        led_b: led_b { gpios = <&mcp23017_0 7 GPIO_ACTIVE_HIGH>; };
    };

    status_led_device: status_led_device {
        compatible = "zmk,status-led";
        led-r = <&led_r>;
        led-g = <&led_g>;
        led-b = <&led_b>;
    };
};
```

## Kconfig

Enable with `CONFIG_ZMK_STATUS_LED=y` (it selects `LED`, and `PWM` when the
channels are `pwm-leds`). Options:

| Option | Default | Meaning |
|---|---|---|
| `ZMK_STATUS_LED_BRIGHTNESS_PERCENT` | 50 | brightness of every lit signal (%); a duty cycle on `pwm-leds` channels, ignored on `gpio-leds` ones |
| `ZMK_STATUS_LED_BATTERY_ERROR_LEVEL` | 10 | battery % that latches the solid error state |
| `ZMK_STATUS_LED_BOOT_BLINKS` | 3 | quick blinks at boot |
| `ZMK_STATUS_LED_ADV_PERIOD_MS` | 2000 | advertising blink period |
| `ZMK_STATUS_LED_ADV_PULSE_MS` | 100 | advertising blink on-time |
