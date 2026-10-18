# zmk-status-led

Three-channel (RGB) status LED for ZMK keyboards. Pure devicetree +
Kconfig — no keymap changes needed. Channels are plain GPIOs: on/off only,
no PWM/brightness. They may sit on SoC pins or a GPIO expander (e.g.
MCP23017 over I2C — see [keeb](../keeb-module/boards/shields/keeb)).

## Palette (priority order)

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

```dts
/ {
    leds {
        compatible = "gpio-leds";
        /* Example: KY-016 RGB module on an MCP23017's free GPA pins
         * (module pin "-" is the common cathode -> GND). */
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

Enable with `CONFIG_ZMK_STATUS_LED=y`. Options:

| Option | Default | Meaning |
|---|---|---|
| `ZMK_STATUS_LED_BATTERY_ERROR_LEVEL` | 10 | battery % that latches the solid error state |
| `ZMK_STATUS_LED_BOOT_BLINKS` | 3 | quick blinks at boot |
| `ZMK_STATUS_LED_ADV_PERIOD_MS` | 2000 | advertising blink period |
| `ZMK_STATUS_LED_ADV_PULSE_MS` | 100 | advertising blink on-time |
