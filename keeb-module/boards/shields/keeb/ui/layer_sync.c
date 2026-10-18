/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Central half: tell the peripheral which layer's artwork to show.
 *
 * Two jobs:
 *   - push the active layer whenever it changes (&keeb_layer_art is a
 *     BEHAVIOR_LOCALITY_GLOBAL behaviour, so ZMK forwards it to the peripheral),
 *   - poll the split transport for the peer link state, because ZMK raises no
 *     central-side event when a peripheral connects. On the connect edge the
 *     current layer is pushed again, otherwise a peripheral that connects
 *     after boot would keep showing layer 0 art.
 */

#include <zephyr/device.h>
#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>

#include <zmk/behavior.h>
#include <zmk/display.h>
#include <zmk/event_manager.h>
#include <zmk/events/layer_state_changed.h>
#include <zmk/events/position_state_changed.h>
#include <zmk/keymap.h>
#include <zmk/matrix.h>
#include <zmk/split/transport/central.h>
#include <zmk/split/transport/types.h>

#include "keeb_ui.h"
#include "layer_sync.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#if !DT_NODE_HAS_STATUS(DT_NODELABEL(layer_art), okay)
#error "CONFIG_KBEEB_UI needs the layer_art behaviour node from keeb.dtsi"
#endif

#define LAYER_ART_NODE DT_NODELABEL(layer_art)
#define LAYER_ART_DEV DEVICE_DT_NAME(LAYER_ART_NODE)

/* ZMK ships the behaviour name in a 16 byte split payload (and logs a
 * "Truncated behavior label" warning if it does not fit), so the node name has
 * to stay short. Enforced here because otherwise it fails at runtime. */
BUILD_ASSERT(sizeof(LAYER_ART_DEV) <= 16,
	     "layer_art node name is too long for the split transport payload (16 bytes)");

static atomic_t peer_connected;

bool keeb_layer_sync_peer_connected(void) { return atomic_get(&peer_connected) != 0; }

static void push_active_layer(void) {
	struct zmk_behavior_binding binding = {
		.param1 = zmk_keymap_highest_layer_active(),
		.param2 = 0,
		.behavior_dev = LAYER_ART_DEV,
	};
	struct zmk_behavior_binding_event event = {
		.layer = zmk_keymap_highest_layer_active(),
		.position = ZMK_KEYMAP_LEN, /* not a real key press */
		.timestamp = k_uptime_get(),
		.source = ZMK_POSITION_STATE_CHANGE_SOURCE_LOCAL,
	};

	int err = zmk_behavior_invoke_binding(&binding, event, true);
	if (err < 0) {
		LOG_WRN("Failed to push layer artwork to the peripheral (%d)", err);
	}
}

static void check_peer(void) {
	bool connected = false;

	STRUCT_SECTION_FOREACH(zmk_split_transport_central, transport) {
		if (!transport->api || !transport->api->get_status) {
			continue;
		}

		struct zmk_split_transport_status status = transport->api->get_status();

		if (status.available &&
		    status.connections != ZMK_SPLIT_TRANSPORT_CONNECTIONS_STATUS_DISCONNECTED) {
			connected = true;
		}
	}

	const bool was_connected = atomic_set(&peer_connected, connected) != 0;

	if (was_connected != connected) {
		/* The link indicator on the left panel reads this value. */
		keeb_ui_request_draw();
	}

	if (connected && !was_connected) {
		push_active_layer();
	}
}

static void poll_work_cb(struct k_work *work) {
	ARG_UNUSED(work);
	check_peer();
}

static K_WORK_DEFINE(poll_work, poll_work_cb);

static void poll_timer_fn(struct k_timer *timer) {
	ARG_UNUSED(timer);
	k_work_submit(&poll_work);
}

K_TIMER_DEFINE(poll_timer, poll_timer_fn, NULL);

static int layer_changed_cb(const zmk_event_t *eh) {
	ARG_UNUSED(eh);
	push_active_layer();
	return 0;
}

ZMK_LISTENER(keeb_layer_sync, layer_changed_cb);
ZMK_SUBSCRIPTION(keeb_layer_sync, zmk_layer_state_changed);

static int keeb_layer_sync_init(void) {
	k_timer_start(&poll_timer, K_MSEC(CONFIG_KBEEB_UI_LAYER_SYNC_POLL_MS),
		      K_MSEC(CONFIG_KBEEB_UI_LAYER_SYNC_POLL_MS));
	return 0;
}

SYS_INIT(keeb_layer_sync_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);
