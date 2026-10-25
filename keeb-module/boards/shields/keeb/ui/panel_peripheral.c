/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Peripheral (right) panel.
 *
 * The peripheral has no host connection and no keymap state of its own: ZMK
 * sends it behaviour invocations and nothing else. So everything on this panel
 * arrives through the keeb,layer-art push (see ui/layer_sync.c on the central):
 * param1 is the active layer's artwork to show, param2 is the device the
 * central is talking to. Both land here as atomics and are read at draw time.
 *
 * The layout itself is the compiled-in preset in ui/widget_model.c - preset 0
 * is the artwork with a connected-device strip, preset 1 is the device alone
 * (CONFIG_KBEEB_UI_PERIPHERAL_PRESET).
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>

#include <lvgl.h>

#include "art/layer_art.h"
#include "keeb_ui.h"
#include "panel_peripheral.h"
#include "panels.h"
#include "widget_model.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

static atomic_t art_layer;
static atomic_t device_id;

static struct keeb_ui_state state;

void keeb_art_select(uint8_t layer) {
	if (atomic_get(&art_layer) == (int)layer) {
		return;
	}

	LOG_DBG("art layer %u", layer);

	atomic_set(&art_layer, layer);
	keeb_ui_request_draw();
}

void keeb_device_select(uint8_t id) {
	if (atomic_get(&device_id) == (int)id) {
		return;
	}

	LOG_DBG("device id %u", id);

	atomic_set(&device_id, id);
	keeb_ui_request_draw();
}

void keeb_panel_draw(struct keeb_ctx *ctx) {
	memset(&state, 0, sizeof(state));

	state.layer = (uint8_t)atomic_get(&art_layer);
	state.art_layer = state.layer;
	state.device_id = (uint8_t)atomic_get(&device_id);

	/* No battery, no link, no host readouts on this half: the left half owns
	 * them, and an invalid flag draws "--" rather than a wrong number. */
	state.left_valid = false;
	state.right_valid = false;

	keeb_ui_render(ctx, &state);
}
