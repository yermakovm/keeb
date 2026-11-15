/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Layer indication on the RGB status LED: this half lights its own KY-016 in
 * the color configured for the layer it is on (zmk-status-led layer color,
 * see zmk_status_led.h).
 *
 * The colors are not hardcoded here any more: they are the per-layer table in
 * the settings channel (keeb-module/settings/keeb_settings.c), one color per
 * keymap layer index, editable from the web configurator and mirrored to both
 * halves by the settings relay.  They are independent of the BLE/status colors
 * (error red, connected flash, advertising pulse): changing one leaves the
 * other alone.
 *
 * Layer indices are the keymap layer order in config/keeb.keymap (HOME,
 * NAV, FUN, MEDIA, GAME) - the same indices &mo/&to use, and the index a
 * color is pinned to.
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

#include "keeb_settings.h"
#include "layer_indicate.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

/* What this half last indicated, so a color the host changed shows up on the
 * current layer without waiting for the next layer change. */
static uint8_t indicated_layer;

void keeb_layer_indicate(uint8_t layer) {
	indicated_layer = layer;
	zmk_status_led_set_layer_rgb(keeb_settings_layer_color(layer));
}

void keeb_layer_indicate_refresh(void) {
	zmk_status_led_set_layer_rgb(keeb_settings_layer_color(indicated_layer));
}

#if defined(CONFIG_SHIELD_KEEB_LEFT)
/* Central half: the layer state is authoritative here, take it directly;
 * the layer_art push arrives too but changes nothing. */
static int layer_changed_cb(const zmk_event_t *eh) {
	ARG_UNUSED(eh);
	keeb_layer_indicate(zmk_keymap_highest_layer_active());
	return 0;
}

ZMK_LISTENER(keeb_layer_indicate, layer_changed_cb);
ZMK_SUBSCRIPTION(keeb_layer_indicate, zmk_layer_state_changed);
#endif /* LEFT */
