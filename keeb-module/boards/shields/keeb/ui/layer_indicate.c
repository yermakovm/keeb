/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Layer indication on the RGB status LED: each half lights its own KY-016
 * in a solid color for its non-home layers (zmk-status-led layer color,
 * see zmk_status_led.h):
 *
 *   LEFT half  NAV  (layer 1) -> green   FUN  (layer 2) -> blue
 *   RIGHT half MEDIA(layer 3) -> green   GAME (layer 4) -> blue
 *   HOME (layer 0) and anything else -> off (normal status palette).
 *
 * Layer indices are the keymap layer order in config/keeb.keymap (HOME,
 * NAV, FUN, MEDIA, GAME) - the same indices &mo/&to use.
 *
 * The LEFT half is the split central, so it sees zmk_layer_state_changed
 * directly. The RIGHT half is the peripheral and ZMK does not replicate
 * layer state to peripherals; it learns the layer from the same
 * layer_art push the status screen uses (see layer_sync.c, which also
 * re-pushes on peripheral connect).
 */

#include <zephyr/devicetree.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include <zmk/event_manager.h>
#include <zmk/events/layer_state_changed.h>
#include <zmk/keymap.h>
#include <zmk/status_led.h>

#include "layer_indicate.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#define LAYER_HOME 0
#define LAYER_NAV 1
#define LAYER_FUN 2
#define LAYER_MEDIA 3
#define LAYER_GAME 4

void keeb_layer_indicate(uint8_t layer) {
#if defined(CONFIG_SHIELD_KEEB_LEFT)
	switch (layer) {
	case LAYER_NAV:
		zmk_status_led_set_layer_color(ZMK_STATUS_LED_COLOR_GREEN);
		break;
	case LAYER_FUN:
		zmk_status_led_set_layer_color(ZMK_STATUS_LED_COLOR_BLUE);
		break;
	default:
		zmk_status_led_set_layer_color(ZMK_STATUS_LED_COLOR_OFF);
		break;
	}
#else  /* right half */
	switch (layer) {
	case LAYER_MEDIA:
		zmk_status_led_set_layer_color(ZMK_STATUS_LED_COLOR_GREEN);
		break;
	case LAYER_GAME:
		zmk_status_led_set_layer_color(ZMK_STATUS_LED_COLOR_BLUE);
		break;
	default:
		zmk_status_led_set_layer_color(ZMK_STATUS_LED_COLOR_OFF);
		break;
	}
#endif
}

#if defined(CONFIG_SHIELD_KEEB_LEFT)
/* Central half: the layer state is authoritative here, take it directly;
 * the layer_art push arrives too but is a no-op (same color). */
static int layer_changed_cb(const zmk_event_t *eh) {
	ARG_UNUSED(eh);
	keeb_layer_indicate(zmk_keymap_highest_layer_active());
	return 0;
}

ZMK_LISTENER(keeb_layer_indicate, layer_changed_cb);
ZMK_SUBSCRIPTION(keeb_layer_indicate, zmk_layer_state_changed);
#endif /* LEFT */
