/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Peripheral (right) panel: the same rounded frame on every layer, with the
 * active layer's artwork inside. No battery, no link indicator - the left half
 * owns all status readouts, so this panel only ever changes its artwork.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>

#include <lvgl.h>

#include "art/layer_art.h"
#include "keeb_ui.h"
#include "panel_peripheral.h"
#include "panels.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

static atomic_t art_layer;

void keeb_art_select(uint8_t layer) {
	if (atomic_get(&art_layer) == (int)layer) {
		return;
	}

	LOG_DBG("art layer %u", layer);

	atomic_set(&art_layer, layer);
	keeb_ui_request_draw();
}

void keeb_panel_draw(struct keeb_ctx *ctx) {
	keeb_frame(ctx, 0, 0, ctx->w, ctx->h, 4);

	const lv_image_dsc_t *art = keeb_layer_art(atomic_get(&art_layer));
	if (!art) {
		return;
	}

	/* Artwork is authored for the area inside the frame; centre it and let
	 * the canvas clip anything larger. */
	const int16_t x = (int16_t)((ctx->w - (int16_t)art->header.w) / 2);
	const int16_t y = (int16_t)((ctx->h - (int16_t)art->header.h) / 2);

	lv_area_t coords = {x, y, x + (int16_t)art->header.w - 1, y + (int16_t)art->header.h - 1};

	/* The artwork is a stencil: LVGL blends it as a mask in the current ink
	 * colour, so CONFIG_ZMK_DISPLAY_INVERT flips it along with the frame. */
	lv_draw_image_dsc_t dsc;
	lv_draw_image_dsc_init(&dsc);
	dsc.src = art;
	dsc.recolor = KBEEB_INK;
	dsc.recolor_opa = LV_OPA_COVER;

	lv_draw_image(&ctx->layer, &dsc, &coords);
}
