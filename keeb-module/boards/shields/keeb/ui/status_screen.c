/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * ZMK status screen entry point (CONFIG_ZMK_DISPLAY_STATUS_SCREEN_CUSTOM).
 *
 * ZMK calls this once from the display work queue and loads whatever it
 * returns as the active screen. Everything below that is a single canvas that
 * the panel code paints into - see keeb_ui.c.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include <lvgl.h>

#include <zmk/display/status_screen.h>

#include "keeb_ui.h"
#include "panels.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

lv_obj_t *zmk_display_status_screen() {
	/* ZMK loads whatever this returns; the canvas covers the whole panel. */
	lv_obj_t *screen = lv_obj_create(NULL);

	lv_obj_set_style_pad_all(screen, 0, 0);

	keeb_ui_create(screen, keeb_panel_draw);
	keeb_ui_request_draw();

	return screen;
}
