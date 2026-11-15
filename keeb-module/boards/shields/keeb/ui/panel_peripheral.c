/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Peripheral (right) panel.
 *
 * The peripheral has no host connection and no keymap state of its own: ZMK
 * sends it behaviour invocations and nothing else. Two pushes arrive here:
 *
 *   keeb,layer-art  param1 = the active layer, param2 = the device the central
 *                   is talking to (see layer_sync.c on the central).
 *   keeb,ui-stat    param1 = the central half's typing rate, param2 = active
 *                   BLE profile, profile count, host link signal (packing in
 *                   behavior_ui_stat.c).
 *
 * Both land as atomics and are read at draw time. The typing rate is the whole
 * keyboard's: only the central raises keycode events, so only the central
 * counts (wpm.c).
 *
 * The table this panel draws starts as CONFIG_KEEB_UI_PERIPHERAL_PRESET, and
 * it does not follow the layer: layer changes still arrive (the LED indication
 * and preset 0's artwork use them), but they do not swap what the panel shows.
 * A host connected to the central can replace the table at runtime - the
 * central relays it with ui/behavior_keeb_panel.c and re-pushes on the connect
 * edge - so the compiled-in preset is the boot default, not the last word.
 */

#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>
#include <zephyr/sys/util.h>

#include <lvgl.h>

#include "bongo.h"
#include "keeb_ui.h"
#include "panel_peripheral.h"
#include "panels.h"
#include "widget_model.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

/** How often the panel checks whether the cat has a new frame to show. */
#define CAT_TICK_MS 250

static atomic_t art_layer;
static atomic_t device_id;
static atomic_t stat_wpm = ATOMIC_INIT(0);
static atomic_t stat_profile = ATOMIC_INIT(KEEB_PROFILE_NONE);
static atomic_t stat_rssi = ATOMIC_INIT(KEEB_RSSI_INVALID);

static struct keeb_ui_state state;

/** Whether the active table has a cat in it, i.e. whether the tick below has
 * anything to animate. Worked out once, from the table itself. */
static bool cat_shown;

/* Which cat frame is on the glass, so the tick below only redraws when the
 * frame would actually change. */
static const lv_image_dsc_t *drawn_frame;

static const lv_image_dsc_t *cat_frame(void) {
	return keeb_bongo_frame((uint8_t)atomic_get(&stat_wpm), k_uptime_get());
}

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

void keeb_ui_stat(uint32_t wpm, uint32_t packed) {
	LOG_DBG("ui stat wpm=%u profile=%u rssi=%u", (uint32_t)MIN(wpm, 255u), packed & 0xffu,
		(packed >> 16) & 0xffu);

	atomic_set(&stat_wpm, (int)MIN(wpm, 255u));
	atomic_set(&stat_profile, (int)packed);
	atomic_set(&stat_rssi, (int)((packed >> 16) & 0xffu));

	keeb_ui_request_draw();
}

void keeb_panel_draw(struct keeb_ctx *ctx) {
	const uint32_t packed = (uint32_t)atomic_get(&stat_profile);

	memset(&state, 0, sizeof(state));

	state.layer = (uint8_t)atomic_get(&art_layer);
	state.art_layer = state.layer;
	state.device_id = (uint8_t)atomic_get(&device_id);

	/* No battery, no link, no host readouts on this half: the left half owns
	 * them, and an invalid flag draws "--" rather than a wrong number. */
	state.left_valid = false;
	state.right_valid = false;

	state.wpm = (uint8_t)atomic_get(&stat_wpm);
	state.profile_active = (uint8_t)(packed & 0xffu);
	state.profile_count = (uint8_t)((packed >> 8) & 0xffu);
	state.rssi_pct = (uint8_t)atomic_get(&stat_rssi);
	drawn_frame = cat_frame();

	keeb_ui_render(ctx, &state);
}

static void cat_timer_fn(struct k_timer *timer) {
	ARG_UNUSED(timer);

	/* A frame that is already on the glass costs nothing to skip: the panel
	 * only redraws when the picture would actually differ. */
	if (!cat_shown || cat_frame() == drawn_frame) {
		return;
	}

	keeb_ui_request_draw();
}

K_TIMER_DEFINE(cat_timer, cat_timer_fn, NULL);

static int keeb_panel_peripheral_init(void) {
	/* After the model's own init, which has applied CONFIG_KEEB_UI_PERIPHERAL_
	 * PRESET by now, so the table is the one this panel will draw. */
	const struct keeb_widget *table = keeb_ui_widgets();

	for (uint8_t i = 0; i < keeb_ui_widget_count(); i++) {
		if (table[i].kind == KEEB_WID_BONGO) {
			cat_shown = true;
			break;
		}
	}

	if (cat_shown) {
		k_timer_start(&cat_timer, K_MSEC(CAT_TICK_MS), K_MSEC(CAT_TICK_MS));
	}

	return 0;
}

/* 91: one step after the widget model's own init (CONFIG_APPLICATION_INIT_PRIORITY
 * is 90). A literal, because Zephyr stringifies the priority into the section
 * name, so an expression there fails the link. */
SYS_INIT(keeb_panel_peripheral_init, APPLICATION, 91);
