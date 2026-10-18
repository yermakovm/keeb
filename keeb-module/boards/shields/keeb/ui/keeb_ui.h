/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Shared drawing surface for the keeb status screens.
 *
 * Both halves carry a nice!view (LS011B7DH03, 160x68, 1 bit). The whole UI is
 * rendered into an L8 canvas and then handed to LVGL, which dithers it down to
 * the panel's 1 bit framebuffer. Drawing into a canvas (instead of laying out
 * LVGL widgets) is what makes the rotation setting possible: the UI is laid out
 * in the orientation the user looks at, then the composed image is rotated by
 * lv_draw_sw_rotate() before it reaches the panel. This mirrors the approach of
 * ZMK's own nice!view custom status screen.
 */

#pragma once

#include <zephyr/types.h>
#include <zephyr/sys/util.h>

#include <zmk/keymap.h>

#include <lvgl.h>

/** Number of keymap layers, i.e. how many pips/artworks the UI has to cover. */
#define KBEEB_LAYER_COUNT ZMK_KEYMAP_LAYERS_LEN

/* Physical panel geometry (never rotates - it is the panel). */
#define KBEEB_PANEL_W 160
#define KBEEB_PANEL_H 68

/*
 * Rotation of the composed UI, selected in Kconfig. 90/270 also flips the
 * layout: the UI is then designed in a 68x160 portrait space and rotated into
 * the 160x68 framebuffer, which is what a portrait-mounted panel needs.
 */
/* Integer degrees: enums cannot be used in #if, and the whole compositor is
 * compiled either way based on this value. */
#if IS_ENABLED(CONFIG_KBEEB_UI_ROTATION_90)
#define KBEEB_UI_ROTATION_DEG 90
#elif IS_ENABLED(CONFIG_KBEEB_UI_ROTATION_180)
#define KBEEB_UI_ROTATION_DEG 180
#elif IS_ENABLED(CONFIG_KBEEB_UI_ROTATION_270)
#define KBEEB_UI_ROTATION_DEG 270
#else
#define KBEEB_UI_ROTATION_DEG 0
#endif

#define KBEEB_UI_ROTATION_CONCAT_(d) LV_DISPLAY_ROTATION_##d
#define KBEEB_UI_ROTATION_CONCAT(d) KBEEB_UI_ROTATION_CONCAT_(d)
#define KBEEB_UI_ROTATION KBEEB_UI_ROTATION_CONCAT(KBEEB_UI_ROTATION_DEG)

#if KBEEB_UI_ROTATION_DEG == 90 || KBEEB_UI_ROTATION_DEG == 270
#define KBEEB_UI_PORTRAIT 1
#else
#define KBEEB_UI_PORTRAIT 0
#endif

#if KBEEB_UI_PORTRAIT
#define KBEEB_UI_W KBEEB_PANEL_H
#define KBEEB_UI_H KBEEB_PANEL_W
#else
#define KBEEB_UI_W KBEEB_PANEL_W
#define KBEEB_UI_H KBEEB_PANEL_H
#endif

/*
 * Panel ink/paper colours. A nice!view is white paper with black ink unless
 * CONFIG_ZMK_DISPLAY_INVERT is set (the same knob ZMK's mono theme uses).
 */
#if IS_ENABLED(CONFIG_ZMK_DISPLAY_INVERT)
#define KBEEB_PAPER lv_color_black()
#define KBEEB_INK lv_color_white()
#else
#define KBEEB_PAPER lv_color_white()
#define KBEEB_INK lv_color_black()
#endif

/** Fonts used by the status screen (all selected in the shield's Kconfig). */
#define KBEEB_FONT_SMALL (&lv_font_montserrat_8)  /* labels, percentages */
#define KBEEB_FONT_BODY (&lv_font_montserrat_16)  /* layer names */
#define KBEEB_FONT_DIGIT (&lv_font_montserrat_26) /* layer number */

/** A drawing session: one canvas plus the LVGL layer used for every draw call. */
struct keeb_ctx {
	lv_layer_t layer;
	lv_obj_t *canvas;
	int16_t w;
	int16_t h;
};

/** Panel content callback: draws one frame into the logical (w x h) space. */
typedef void (*keeb_ui_draw_fn)(struct keeb_ctx *ctx);

/**
 * Create the on-screen canvas. Called once from zmk_display_status_screen().
 *
 * @param parent Screen object.
 * @param content Draw callback invoked on the display work queue.
 * @return The canvas object (already aligned to the panel origin).
 */
lv_obj_t *keeb_ui_create(lv_obj_t *parent, keeb_ui_draw_fn content);

/**
 * Re-render the current content. Safe from any thread/ISR-free context: the
 * actual drawing happens on the ZMK display work queue. Call this after
 * changing whatever state the content callback reads.
 */
void keeb_ui_request_draw(void);

/* -------------------------------------------------------------------------
 * Draw primitives. All coordinates are in the logical UI space (KBEEB_UI_*),
 * sizes are width/height in pixels, (x, y) is the top-left corner.
 * ------------------------------------------------------------------------- */

/** Open a drawing session on the ctx's canvas (must pair with keeb_ctx_end). */
void keeb_ctx_begin(struct keeb_ctx *ctx);

/** Flush every draw call issued since keeb_ctx_begin() into the canvas buffer. */
void keeb_ctx_end(struct keeb_ctx *ctx);

/** Solid rectangle in `color`. */
void keeb_fill(struct keeb_ctx *ctx, int16_t x, int16_t y, int16_t w, int16_t h,
	       lv_color_t color);

/** Rounded 1px outline - the frame every panel uses. */
void keeb_frame(struct keeb_ctx *ctx, int16_t x, int16_t y, int16_t w, int16_t h, int16_t radius);

/** Horizontal 1px rule. */
void keeb_rule(struct keeb_ctx *ctx, int16_t x, int16_t y, int16_t w);

/** Polyline through `count` points (used for the charge bolt). */
void keeb_polyline(struct keeb_ctx *ctx, const lv_point_t *points, uint32_t count);

/**
 * Draw `text` with `font` at (x, y). The text is laid out inside a box of
 * `area_w` pixels and aligned with `align` (LV_TEXT_ALIGN_LEFT/CENTER/RIGHT).
 */
void keeb_text(struct keeb_ctx *ctx, const lv_font_t *font, int16_t x, int16_t y, int16_t area_w,
	       lv_text_align_t align, const char *text);

/** Draw `text` centred both ways inside the (x, y, w, h) box. */
void keeb_text_centered_in(struct keeb_ctx *ctx, const lv_font_t *font, int16_t x, int16_t y,
			   int16_t w, int16_t h, const char *text);

/** Battery glyph: rounded body + nub, filled according to `percent`. */
void keeb_battery(struct keeb_ctx *ctx, int16_t x, int16_t y, uint8_t percent, bool valid);

/** Horizontal progress bar with a 1px outline. `valid` false = dashed/empty. */
void keeb_bar(struct keeb_ctx *ctx, int16_t x, int16_t y, int16_t w, int16_t h, uint8_t percent,
	      bool valid);

/** Row of `count` layer pips, the `active`-th one filled (active < 0 = none). */
void keeb_pips(struct keeb_ctx *ctx, int16_t x, int16_t y, uint8_t count, int8_t active,
	       int16_t pip_w, int16_t pip_h, int16_t gap);

/** Lightning bolt used for "charging" (7x9 pixels). */
void keeb_bolt(struct keeb_ctx *ctx, int16_t x, int16_t y);

/**
 * One battery readout: label, battery glyph, percentage. Returns the x just
 * past the drawn row so several rows can be chained on one line.
 */
int16_t keeb_battery_row(struct keeb_ctx *ctx, int16_t x, int16_t y, const char *label,
			 uint8_t percent, bool valid);

/** Width of keeb_battery_row(). */
#define KBEEB_BATTERY_ROW_W 54
