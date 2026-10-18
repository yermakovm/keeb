/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include <zmk/display.h>

#include "keeb_ui.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#define CANVAS_COLOR_FORMAT LV_COLOR_FORMAT_L8
#define CANVAS_BPP LV_COLOR_FORMAT_GET_BPP(CANVAS_COLOR_FORMAT)
#define PANEL_BUF_SIZE LV_CANVAS_BUF_SIZE(KBEEB_PANEL_W, KBEEB_PANEL_H, CANVAS_BPP,            \
					  LV_DRAW_BUF_STRIDE_ALIGN)
#define LOGICAL_BUF_SIZE LV_CANVAS_BUF_SIZE(KBEEB_UI_W, KBEEB_UI_H, CANVAS_BPP,                \
					    LV_DRAW_BUF_STRIDE_ALIGN)

BUILD_ASSERT(KBEEB_PANEL_W == 160 && KBEEB_PANEL_H == 68, "nice!view is 160x68");

static uint8_t panel_buf[PANEL_BUF_SIZE] __aligned(LV_DRAW_BUF_ALIGN);
#if KBEEB_UI_ROTATION_DEG != 0
static uint8_t logical_buf[LOGICAL_BUF_SIZE] __aligned(LV_DRAW_BUF_ALIGN);
#endif

static lv_obj_t *panel_canvas;
static lv_obj_t *logical_canvas;
static keeb_ui_draw_fn content;

static void draw_panel(void)
{
	struct keeb_ctx ctx = {0};
	lv_obj_t *target = panel_canvas;
#if KBEEB_UI_ROTATION_DEG != 0
	target = logical_canvas;
#endif

	ctx.canvas = target;
	ctx.w = KBEEB_UI_W;
	ctx.h = KBEEB_UI_H;

	keeb_ctx_begin(&ctx);
	keeb_fill(&ctx, 0, 0, ctx.w, ctx.h, KBEEB_PAPER);

	if (content) {
		content(&ctx);
	}

	keeb_ctx_end(&ctx);

#if KBEEB_UI_ROTATION_DEG != 0
	/* Composed in the viewing orientation -> rotate into panel orientation. */
	lv_draw_sw_rotate(logical_buf, panel_buf, KBEEB_UI_W, KBEEB_UI_H,
			  lv_draw_buf_width_to_stride(KBEEB_UI_W, CANVAS_COLOR_FORMAT),
			  lv_draw_buf_width_to_stride(KBEEB_PANEL_W, CANVAS_COLOR_FORMAT),
			  KBEEB_UI_ROTATION, CANVAS_COLOR_FORMAT);

	lv_obj_invalidate(panel_canvas);
#endif
}

static void draw_work_cb(struct k_work *work)
{
	ARG_UNUSED(work);
	draw_panel();
}

static K_WORK_DEFINE(draw_work, draw_work_cb);

void keeb_ui_request_draw(void)
{
	if (!zmk_display_is_initialized()) {
		/* Nothing to draw into yet; the first render happens with the screen. */
		return;
	}

	k_work_submit_to_queue(zmk_display_work_q(), &draw_work);
}

lv_obj_t *keeb_ui_create(lv_obj_t *parent, keeb_ui_draw_fn content_cb)
{
	content = content_cb;

	panel_canvas = lv_canvas_create(parent);
	lv_canvas_set_buffer(panel_canvas, panel_buf, KBEEB_PANEL_W, KBEEB_PANEL_H,
			     CANVAS_COLOR_FORMAT);
	lv_obj_align(panel_canvas, LV_ALIGN_TOP_LEFT, 0, 0);

#if KBEEB_UI_ROTATION_DEG != 0
	/*
	 * Offscreen scratch canvas: the UI is composed here in the viewing
	 * orientation, then rotated into panel_canvas. It stays a child of the
	 * screen so LVGL can resolve a display for its draw tasks, but it is
	 * hidden so it never paints onto the panel itself.
	 */
	logical_canvas = lv_canvas_create(parent);
	lv_canvas_set_buffer(logical_canvas, logical_buf, KBEEB_UI_W, KBEEB_UI_H,
			     CANVAS_COLOR_FORMAT);
	lv_obj_add_flag(logical_canvas, LV_OBJ_FLAG_HIDDEN);
#endif

	return panel_canvas;
}

/* -----------------------------------------------------------------------------
 * Draw primitives
 * ----------------------------------------------------------------------------- */

void keeb_ctx_begin(struct keeb_ctx *ctx) { lv_canvas_init_layer(ctx->canvas, &ctx->layer); }

void keeb_ctx_end(struct keeb_ctx *ctx) { lv_canvas_finish_layer(ctx->canvas, &ctx->layer); }

void keeb_fill(struct keeb_ctx *ctx, int16_t x, int16_t y, int16_t w, int16_t h, lv_color_t color)
{
	lv_area_t area = {x, y, x + w - 1, y + h - 1};
	lv_draw_rect_dsc_t dsc;

	lv_draw_rect_dsc_init(&dsc);
	dsc.bg_color = color;
	dsc.bg_opa = LV_OPA_COVER;

	lv_draw_rect(&ctx->layer, &dsc, &area);
}

void keeb_frame(struct keeb_ctx *ctx, int16_t x, int16_t y, int16_t w, int16_t h, int16_t radius)
{
	lv_area_t area = {x, y, x + w - 1, y + h - 1};
	lv_draw_rect_dsc_t dsc;

	lv_draw_rect_dsc_init(&dsc);
	dsc.bg_opa = LV_OPA_TRANSP;
	dsc.border_color = KBEEB_INK;
	dsc.border_width = 1;
	dsc.border_opa = LV_OPA_COVER;
	dsc.radius = radius;

	lv_draw_rect(&ctx->layer, &dsc, &area);
}

void keeb_rule(struct keeb_ctx *ctx, int16_t x, int16_t y, int16_t w)
{
	keeb_fill(ctx, x, y, w, 1, KBEEB_INK);
}

void keeb_polyline(struct keeb_ctx *ctx, const lv_point_t *points, uint32_t count)
{
	lv_draw_line_dsc_t dsc;

	lv_draw_line_dsc_init(&dsc);
	dsc.color = KBEEB_INK;
	dsc.width = 1;
	dsc.opa = LV_OPA_COVER;

	for (uint32_t i = 0; i + 1 < count; i++) {
		dsc.p1.x = points[i].x;
		dsc.p1.y = points[i].y;
		dsc.p2.x = points[i + 1].x;
		dsc.p2.y = points[i + 1].y;
		lv_draw_line(&ctx->layer, &dsc);
	}
}

void keeb_text(struct keeb_ctx *ctx, const lv_font_t *font, int16_t x, int16_t y, int16_t area_w,
	       lv_text_align_t align, const char *text)
{
	lv_area_t area = {x, y, x + area_w - 1,
			  y + (int16_t)lv_font_get_line_height(font) - 1};
	lv_draw_label_dsc_t dsc;

	lv_draw_label_dsc_init(&dsc);
	dsc.font = font;
	dsc.color = KBEEB_INK;
	dsc.opa = LV_OPA_COVER;
	dsc.align = align;
	dsc.text = text;

	lv_draw_label(&ctx->layer, &dsc, &area);
}

void keeb_text_centered_in(struct keeb_ctx *ctx, const lv_font_t *font, int16_t x, int16_t y,
			   int16_t w, int16_t h, const char *text)
{
	int32_t line_h = lv_font_get_line_height(font);
	int32_t ty = y + ((h - line_h) / 2);

	if (ty < y) {
		ty = y;
	}

	keeb_text(ctx, font, x, ty, w, LV_TEXT_ALIGN_CENTER, text);
}

void keeb_bar(struct keeb_ctx *ctx, int16_t x, int16_t y, int16_t w, int16_t h, uint8_t percent,
	      bool valid)
{
	keeb_frame(ctx, x, y, w, h, 0);

	if (!valid || h < 3 || w < 3) {
		return;
	}

	if (percent > 100) {
		percent = 100;
	}

	const int16_t inner_w = w - 2;
	const int16_t fill_w = (int16_t)((inner_w * percent) / 100);

	if (fill_w > 0) {
		keeb_fill(ctx, x + 1, y + 1, fill_w, h - 2, KBEEB_INK);
	}
}

void keeb_battery(struct keeb_ctx *ctx, int16_t x, int16_t y, uint8_t percent, bool valid)
{
	/* 14x9 body with a 2x3 nub on the right, matching the mockup icon. */
	keeb_frame(ctx, x, y, 14, 9, 2);
	keeb_fill(ctx, x + 15, y + 3, 2, 3, KBEEB_INK);

	keeb_bar(ctx, x + 2, y + 2, 10, 5, percent, valid);
}

void keeb_pips(struct keeb_ctx *ctx, int16_t x, int16_t y, uint8_t count, int8_t active,
	       int16_t pip_w, int16_t pip_h, int16_t gap)
{
	for (uint8_t i = 0; i < count; i++) {
		const int16_t px = x + (i * (pip_w + gap));

		if ((int8_t)i == active) {
			keeb_fill(ctx, px, y, pip_w, pip_h, KBEEB_INK);
		} else {
			keeb_frame(ctx, px, y, pip_w, pip_h, 0);
		}
	}
}

void keeb_bolt(struct keeb_ctx *ctx, int16_t x, int16_t y)
{
	/* 7x9 lightning bolt */
	static const lv_point_t points[] = {
		{5, 0}, {1, 4}, {4, 4}, {2, 9}, {7, 4}, {4, 4}, {5, 0},
	};

	for (uint32_t i = 0; i + 1 < ARRAY_SIZE(points); i++) {
		lv_point_t p1 = points[i];
		lv_point_t p2 = points[i + 1];

		p1.x += x;
		p1.y += y;
		p2.x += x;
		p2.y += y;

		keeb_polyline(ctx, (const lv_point_t[]){p1, p2}, 2);
	}
}

int16_t keeb_battery_row(struct keeb_ctx *ctx, int16_t x, int16_t y, const char *label,
			 uint8_t percent, bool valid)
{
	char buf[6];

	keeb_text(ctx, KBEEB_FONT_SMALL, x, y + 1, 8, LV_TEXT_ALIGN_LEFT, label);
	keeb_battery(ctx, x + 9, y, percent, valid);

	if (valid) {
		snprintf(buf, sizeof(buf), "%u%%", percent);
	} else {
		snprintf(buf, sizeof(buf), "--%%");
	}

	keeb_text(ctx, KBEEB_FONT_SMALL, x + 28, y + 1, KBEEB_BATTERY_ROW_W - 28,
		  LV_TEXT_ALIGN_RIGHT, buf);

	return x + KBEEB_BATTERY_ROW_W;
}
