/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Central (left) panel: fills the widget model's state from ZMK and hands it to
 * the draw pass.
 *
 * Everything the panel can show is read from ZMK here, at draw time, on the
 * display work queue - except the right half's battery, which is the one value
 * ZMK only exposes as an event. The central subscribes to the peripheral's
 * Battery Service characteristic (CONFIG_ZMK_SPLIT_BLE_CENTRAL_BATTERY_LEVEL_
 * FETCHING, set in keeb_left.conf) and ZMK re-raises each reading as
 * zmk_peripheral_battery_state_changed, so that one number is cached in
 * atomics.
 *
 * Which widgets appear, and where, is no longer this file's business: that is
 * the widget table in ui/widget_model.c, editable over the TLV channel. This
 * file owns the values; the table owns the layout.
 *
 * NB: every string handed to LVGL must outlive keeb_ctx_end() - LVGL defers
 * glyph rendering until the canvas layer is finished, which happens *after*
 * the draw callback returned. Anything built on a stack here renders as
 * garbage, so all formatted text lives in the static state below.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>

#include <string.h>

#include <lvgl.h>

#include <zmk/battery.h>
#include <zmk/display.h>
#include <zmk/endpoints.h>
#include <zmk/events/battery_state_changed.h>
#include <zmk/events/endpoint_changed.h>
#include <zmk/events/layer_state_changed.h>
#include <zmk/events/split_peripheral_status_changed.h>
#include <zmk/events/usb_conn_state_changed.h>
#include <zmk/keymap.h>
#include <zmk/usb.h>

#if IS_ENABLED(CONFIG_ZMK_BLE)
#include <zmk/ble.h>
#include <zmk/events/ble_active_profile_changed.h>
#endif

#include "keeb_ui.h"
#include "layer_sync.h"
#include "panels.h"
#include "widget_model.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

/* Right half battery, reported over the split link. */
static atomic_t remote_level;
static atomic_t remote_present;

/* The panel's snapshot: ZMK-owned fields filled here, host-owned slots copied
 * in by keeb_ui_render(), strings formatted there too. Touched only from the
 * display work queue (draws are serialized), so a plain static is enough. */
static struct keeb_ui_state state;

static bool remote_battery(uint8_t *level) {
	if (!atomic_get(&remote_present)) {
		return false;
	}

	*level = (uint8_t)atomic_get(&remote_level);
	return true;
}

static void collect(void) {
	uint8_t level;

	memset(&state, 0, sizeof(state));

	state.layer = zmk_keymap_highest_layer_active();

	const char *name = zmk_keymap_layer_name(zmk_keymap_layer_index_to_id(state.layer));

	snprintf(state.layer_name, sizeof(state.layer_name), "%s",
		 (name && name[0] != '\0') ? name : "LAYER");

	state.left_level = zmk_battery_state_of_charge();
	state.left_valid = true;
	state.charging = zmk_usb_is_powered();
	state.host_connected = zmk_endpoint_is_connected();
	state.peer_connected = keeb_layer_sync_peer_connected();
	state.right_valid = remote_battery(&level);
	state.right_level = state.right_valid ? level : 0;

	/* The connected device, computed the same way the central computes it
	 * for the peripheral (layer_sync.c), so both halves agree. */
	state.device_id = keeb_split_device_id();

#if IS_ENABLED(CONFIG_ZMK_BLE)
	if (state.device_id != KEEB_DEV_NONE && state.device_id != KEEB_DEV_USB) {
		const char *peer = zmk_ble_active_profile_name();

		if (peer && peer[0] != '\0') {
			snprintf(state.device_name, sizeof(state.device_name), "%s", peer);
		}
	}
#endif

	/* On this half the artwork is the layer the keymap says is active. */
	state.art_layer = state.layer;
}

void keeb_panel_draw(struct keeb_ctx *ctx) {
	collect();
	keeb_ui_render(ctx, &state);
}

static int on_event(const zmk_event_t *eh) {
	if (eh->event == &zmk_event_zmk_peripheral_battery_state_changed) {
		const struct zmk_peripheral_battery_state_changed *event =
			as_zmk_peripheral_battery_state_changed(eh);

		if (event) {
			atomic_set(&remote_level, event->state_of_charge);
			atomic_set(&remote_present, 1);
		}
	} else if (eh->event == &zmk_event_zmk_split_peripheral_status_changed) {
		const struct zmk_split_peripheral_status_changed *event =
			as_zmk_split_peripheral_status_changed(eh);

		if (event && !event->connected) {
			atomic_set(&remote_present, 0);
		}
	}

	keeb_ui_request_draw();

	return 0;
}

ZMK_LISTENER(keeb_central_panel, on_event);
ZMK_SUBSCRIPTION(keeb_central_panel, zmk_layer_state_changed);
ZMK_SUBSCRIPTION(keeb_central_panel, zmk_battery_state_changed);
ZMK_SUBSCRIPTION(keeb_central_panel, zmk_peripheral_battery_state_changed);
ZMK_SUBSCRIPTION(keeb_central_panel, zmk_split_peripheral_status_changed);
ZMK_SUBSCRIPTION(keeb_central_panel, zmk_endpoint_changed);
ZMK_SUBSCRIPTION(keeb_central_panel, zmk_usb_conn_state_changed);
#if IS_ENABLED(CONFIG_ZMK_BLE)
ZMK_SUBSCRIPTION(keeb_central_panel, zmk_ble_active_profile_changed);
#endif
