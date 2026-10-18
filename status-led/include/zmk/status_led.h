/*
 * zmk-status-led - public API.
 *
 * The module drives a three-channel RGB status LED through a fixed state
 * palette (error/connected/advertising/boot). The one runtime hook lets a
 * keyboard override the LED with a solid layer-indication color while a
 * non-default layer is active.
 *
 * Priority: battery ERROR (red) always wins; the layer color takes over
 * the connected-flash / advertising-pulse states; OFF restores them.
 * The color is latched while the keyboard sleeps or during boot blinks
 * and is applied when either ends.
 */

#pragma once

#include <stdint.h>

enum zmk_status_led_color {
	ZMK_STATUS_LED_COLOR_OFF,
	ZMK_STATUS_LED_COLOR_RED,
	ZMK_STATUS_LED_COLOR_GREEN,
	ZMK_STATUS_LED_COLOR_BLUE,
};

/* Set the solid layer-indication color; ZMK_STATUS_LED_COLOR_OFF clears it
 * and returns the LED to the normal status palette. Safe to call from
 * event handlers; nothing here blocks. */
void zmk_status_led_set_layer_color(enum zmk_status_led_color color);
