/*
 * zmk-status-led - public API.
 *
 * The module drives a three-channel RGB status LED through two independent
 * color groups:
 *
 *   - the status palette: red for the battery error, green for the
 *     profile-connected flash, blue for the advertising pulse;
 *   - the layer color: one solid color the keyboard sets for the active layer.
 *
 * They are separate values. Retuning the palette does not move the layer
 * color, and a layer color never changes what connect/advertising look like.
 *
 * Every lit color is driven at CONFIG_ZMK_STATUS_LED_BRIGHTNESS_PERCENT
 * (default 50%), so this API picks which channels are lit, not how bright
 * they are.
 *
 * Priority: battery ERROR (red) always wins; the layer color takes over
 * the connected-flash / advertising-pulse states; 0 restores them.
 * The color is latched while the keyboard sleeps or during boot blinks
 * and is applied when either ends.
 */

#pragma once

#include <stdint.h>

/* Set the solid layer-indication color, packed 0x00RRGGBB; 0 clears it and
 * returns the LED to the normal status palette. Safe to call from event
 * handlers; nothing here blocks. */
void zmk_status_led_set_layer_rgb(uint32_t rgb);

/*
 * The palette every lit signal uses, retunable while the keyboard runs by the
 * config channel (zmk-config's keeb-module settings).  Colors are packed
 * 0x00RRGGBB; brightness is a 0..100 percent applied to every lit signal, so
 * the palette keeps its proportions and dims as a whole.
 *
 * The three colors are the three signals the module already had: red is the
 * battery error, green the profile-connected flash, blue the advertising pulse.
 * A boot blink lights all three. None of them is a layer color.
 */
struct zmk_status_led_palette {
	uint8_t brightness_percent;
	uint32_t red;
	uint32_t green;
	uint32_t blue;
};

void zmk_status_led_set_palette(const struct zmk_status_led_palette *palette);
void zmk_status_led_get_palette(struct zmk_status_led_palette *palette);
