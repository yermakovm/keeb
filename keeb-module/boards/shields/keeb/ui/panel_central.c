/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Central (left) panel: "KEYBOARD SYSTEM".
 *
 * Everything except the peer battery level is read straight from ZMK when the
 * panel is drawn (which always happens on the display work queue), so there is
 * no cached state to keep in sync. The right half's battery is the exception:
 * the central polls/subscribes to the peripheral's BAS battery-level
 * characteristic (CONFIG_ZMK_SPLIT_BLE_CENTRAL_BATTERY_LEVEL_FETCHING, set in
 * keeb_left.conf) and republishes each reading as
 * zmk_peripheral_battery_state_changed, which is only observable through
 * that event - so it is cached in atomics.
 *
 * NB: every string handed to keeb_text() must outlive keeb_ctx_end() - LVGL
 * defers the actual glyph rendering until the canvas layer is finished, which
 * happens *after* keeb_panel_draw() has returned. Anything built on the stack
 * of a draw function is rendered as garbage (or not at all), so all formatted
 * text lives in file-scope buffers below.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>

#include <stdio.h>
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

#include "keeb_ui.h"
#include "layer_sync.h"
#include "panels.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

/* Right half battery, reported over the split link. */
static atomic_t remote_level;
static atomic_t remote_present;

/* Panel state snapshot + every formatted string rendered from it. Touched
 * only from the display work queue (draws are serialized), so plain statics
 * are safe. */
static struct keeb_panel_info info;
static char layer_num_str[4];  /* "01".."05" */
static char layer_pos_str[14]; /* "LAYER 1 / 5" */
static char left_pct_str[6];   /* "86%" */
static char right_pct_str[6];  /* "86%" or "--" */

/* Layout inside the 160x68 landscape panel. */
#define HDR_Y 3
#define HDR_RULE_Y 13
#define COL_RULE_X 98
#define FTR_RULE_Y 55
#define FTR_Y 57

/* Power column (x, width); two stacked rows of label + bar. */
#define PWR_X 102
#define PWR_W 52
#define PWR_LBL_W 30
#define PWR_PCT_X (PWR_X + PWR_LBL_W)
#define PWR_PCT_W (PWR_W - PWR_LBL_W)
#define PWR_ROW1_Y 16
#define PWR_BAR1_Y 27
#define PWR_ROW2_Y 35
#define PWR_BAR2_Y 46
#define PWR_BAR_H 4

/* Layer column. */
#define LAYER_BOX_X 5
#define LAYER_BOX_Y 16
#define LAYER_BOX_W 38
#define LAYER_BOX_H 32
#define LAYER_NAME_X 48
#define LAYER_NAME_Y 19
#define LAYER_NAME_W (COL_RULE_X - LAYER_NAME_X)
#define LAYER_POS_Y 40
#define PIPS_Y 51

static bool remote_battery(uint8_t *level) {
	if (!atomic_get(&remote_present)) {
		return false;
	}

	*level = (uint8_t)atomic_get(&remote_level);
	return true;
}

static void collect(void) {
	uint8_t level;

	memset(&info, 0, sizeof(info));

	info.layer = zmk_keymap_highest_layer_active();

	const char *name = zmk_keymap_layer_name(zmk_keymap_layer_index_to_id(info.layer));

	snprintf(info.layer_name, sizeof(info.layer_name), "%s",
		 (name && name[0] != '\0') ? name : "LAYER");

	info.left_level = zmk_battery_state_of_charge();
	info.charging = zmk_usb_is_powered();
	info.host_connected = zmk_endpoint_is_connected();
	info.peer_connected = keeb_layer_sync_peer_connected();
	info.right_present = remote_battery(&level);
	info.right_level = info.right_present ? level : 0;

	/* All strings are formatted here, in persistent storage - see the
	 * note at the top of the file. */
	snprintf(layer_num_str, sizeof(layer_num_str), "%02u", info.layer + 1);
	snprintf(layer_pos_str, sizeof(layer_pos_str), "LAYER %u / %u", info.layer + 1,
		 KBEEB_LAYER_COUNT);
	snprintf(left_pct_str, sizeof(left_pct_str), "%u%%", info.left_level);
	if (info.right_present) {
		snprintf(right_pct_str, sizeof(right_pct_str), "%u%%", info.right_level);
	} else {
		snprintf(right_pct_str, sizeof(right_pct_str), "--");
	}
}

static void draw_power_row(struct keeb_ctx *ctx, int16_t y, int16_t bar_y, const char *label,
			   const char *pct, uint8_t percent, bool valid) {
	keeb_text(ctx, KBEEB_FONT_SMALL, PWR_X, y, PWR_LBL_W, LV_TEXT_ALIGN_LEFT, label);
	keeb_text(ctx, KBEEB_FONT_SMALL, PWR_PCT_X, y, PWR_PCT_W, LV_TEXT_ALIGN_RIGHT, pct);
	keeb_bar(ctx, PWR_X, bar_y, PWR_W, PWR_BAR_H, percent, valid);
}

static void draw_landscape(struct keeb_ctx *ctx) {
	keeb_frame(ctx, 0, 0, KBEEB_UI_W, KBEEB_UI_H, 4);

	/* Header */
	keeb_text(ctx, KBEEB_FONT_SMALL, 6, HDR_Y, 90, LV_TEXT_ALIGN_LEFT, "KEYBOARD SYSTEM");
	keeb_text(ctx, KBEEB_FONT_SMALL, 96, HDR_Y, 58, LV_TEXT_ALIGN_RIGHT,
		  info.peer_connected ? "LINK: OK" : "LINK: --");
	keeb_rule(ctx, 4, HDR_RULE_Y, 152);

	/* Layer number in its box, pips right below it */
	keeb_frame(ctx, LAYER_BOX_X, LAYER_BOX_Y, LAYER_BOX_W, LAYER_BOX_H, 3);
	keeb_text_centered_in(ctx, KBEEB_FONT_DIGIT, LAYER_BOX_X, LAYER_BOX_Y, LAYER_BOX_W,
			      LAYER_BOX_H, layer_num_str);
	keeb_pips(ctx, 6, PIPS_Y, KBEEB_LAYER_COUNT, info.layer, 6, 3, 2);

	/* Layer name and position */
	const lv_font_t *name_font = KBEEB_FONT_BODY;
	if (lv_text_get_width(info.layer_name, strlen(info.layer_name), name_font, 0) >
	    LAYER_NAME_W) {
		name_font = KBEEB_FONT_SMALL;
	}
	keeb_text(ctx, name_font, LAYER_NAME_X, LAYER_NAME_Y, LAYER_NAME_W, LV_TEXT_ALIGN_LEFT,
		  info.layer_name);
	keeb_text(ctx, KBEEB_FONT_SMALL, LAYER_NAME_X, LAYER_POS_Y, LAYER_NAME_W,
		  LV_TEXT_ALIGN_LEFT, layer_pos_str);

	/* Power status of both halves, stacked */
	draw_power_row(ctx, PWR_ROW1_Y, PWR_BAR1_Y, "LEFT", left_pct_str, info.left_level, true);
	draw_power_row(ctx, PWR_ROW2_Y, PWR_BAR2_Y, "RIGHT", right_pct_str, info.right_level,
		       info.right_present);

	/* Footer */
	keeb_rule(ctx, 4, FTR_RULE_Y, 152);
	keeb_text(ctx, KBEEB_FONT_SMALL, 6, FTR_Y, 60, LV_TEXT_ALIGN_LEFT, "SYS. READY_");

	if (info.charging) {
		keeb_text(ctx, KBEEB_FONT_SMALL, 66, FTR_Y, 70, LV_TEXT_ALIGN_RIGHT, "CHARGING");
		keeb_bolt(ctx, 145, FTR_Y);
	} else {
		keeb_text(ctx, KBEEB_FONT_SMALL, 66, FTR_Y, 88, LV_TEXT_ALIGN_RIGHT,
			  info.host_connected ? "HOST: READY" : "HOST: --");
	}
}

#if KBEEB_UI_PORTRAIT
static void draw_portrait(struct keeb_ctx *ctx) {
	const lv_font_t *name_font = KBEEB_FONT_BODY;

	if (lv_text_get_width(info.layer_name, strlen(info.layer_name), name_font, 0) >
	    KBEEB_UI_W - 12) {
		name_font = KBEEB_FONT_SMALL;
	}

	keeb_frame(ctx, 0, 0, KBEEB_UI_W, KBEEB_UI_H, 4);

	keeb_text(ctx, KBEEB_FONT_SMALL, 5, 3, 34, LV_TEXT_ALIGN_LEFT, "SYSTEM");
	keeb_text(ctx, KBEEB_FONT_SMALL, 39, 3, 24, LV_TEXT_ALIGN_RIGHT,
		  info.peer_connected ? "LINK" : "--");
	keeb_rule(ctx, 4, 13, 60);

	keeb_frame(ctx, 15, 17, 38, 32, 3);
	keeb_text_centered_in(ctx, KBEEB_FONT_DIGIT, 15, 17, 38, 32, layer_num_str);

	keeb_text(ctx, name_font, 4, 53, 60, LV_TEXT_ALIGN_CENTER, info.layer_name);

	keeb_text(ctx, KBEEB_FONT_SMALL, 4, 70, 60, LV_TEXT_ALIGN_CENTER, layer_pos_str);
	keeb_pips(ctx, 12, 82, KBEEB_LAYER_COUNT, info.layer, 7, 4, 3);

	keeb_text(ctx, KBEEB_FONT_SMALL, 7, 94, 16, LV_TEXT_ALIGN_LEFT, "LEFT");
	keeb_text(ctx, KBEEB_FONT_SMALL, 25, 94, 28, LV_TEXT_ALIGN_RIGHT, left_pct_str);
	keeb_bar(ctx, 7, 105, 46, 4, info.left_level, true);

	keeb_text(ctx, KBEEB_FONT_SMALL, 7, 114, 16, LV_TEXT_ALIGN_LEFT, "RIGHT");
	keeb_text(ctx, KBEEB_FONT_SMALL, 25, 114, 28, LV_TEXT_ALIGN_RIGHT, right_pct_str);
	keeb_bar(ctx, 7, 125, 46, 4, info.right_level, info.right_present);

	keeb_rule(ctx, 4, 138, 60);
	keeb_text(ctx, KBEEB_FONT_SMALL, 4, 142, 60, LV_TEXT_ALIGN_CENTER,
		  info.charging ? "CHARGING"
				: (info.host_connected ? "HOST: READY" : "HOST: --"));
	keeb_text(ctx, KBEEB_FONT_SMALL, 4, 151, 60, LV_TEXT_ALIGN_CENTER, "SYS. READY_");
}
#endif

void keeb_panel_draw(struct keeb_ctx *ctx) {
	collect();

#if KBEEB_UI_PORTRAIT
	if (KBEEB_UI_PORTRAIT && ctx->w < ctx->h) {
		draw_portrait(ctx);
		return;
	}
#endif

	draw_landscape(ctx);
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
