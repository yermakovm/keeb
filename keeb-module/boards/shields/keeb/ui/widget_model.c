/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Widget model implementation: the table, the built-in presets, the host-owned
 * slots, and the draw pass that turns a table into keeb_* calls.
 *
 * The presets are this file's other half: they are written in the same widget
 * language the host can send, so "the shipped look" and "a host-written look"
 * are the same kind of data and one draw pass serves both. Coordinates are in
 * the logical UI space (KBEEB_UI_W x KBEEB_UI_H), i.e. the orientation the user
 * looks at, because keeb_ui.c composes there and rotates into the panel.
 */

#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include <string.h>

#include <lvgl.h>

#include "art/layer_art.h"
#include "keeb_ui.h"
#include "panels.h"
#include "widget_model.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

/* Whether *this* build links the layer artwork. The peripheral has always had
 * it (CONFIG_KBEEB_UI_ART); on the central it is a Kconfig, because the
 * generated stencils are tens of kilobytes and the central's panel is readouts,
 * not pictures. Whatever the answer, keeb_display_info reports it and
 * keeb_ui_validate_widget refuses a KEEB_WID_ART this image cannot draw. */
#if KBEEB_UI_CENTRAL
#define KBEEB_UI_ART_LINKED IS_ENABLED(CONFIG_KBEEB_UI_CENTRAL_ART)
#else
#define KBEEB_UI_ART_LINKED IS_ENABLED(CONFIG_KBEEB_UI_ART)
#endif

/* --------------------------------------------------------------------------
 * Preset tables
 * --------------------------------------------------------------------------
 * Written per orientation because the logical space swaps at 90/270, and per
 * role because the two halves show different things. The central presets
 * reproduce the pre-model panels pixel for pixel; the peripheral presets add
 * the connected-device readout the panel did not have before.
 */

/* Parameter names must not collide with the designators they fill: a macro
 * parameter named `x` would replace the `x` in `.x` too, and the initializer
 * would read `.0 = (0)`. Hence the k-prefixed names. */
#define W_FRAME(kx, ky, kw, kh, radius)                                                           \
	{                                                                                          \
		.kind = KEEB_WID_FRAME, .source = KEEB_SRC_NONE, .x = (kx), .y = (ky), .w = (kw),  \
		.h = (kh), .style = (radius)                                                       \
	}
#define W_RECT(kx, ky, kw, kh, kstyle)                                                            \
	{                                                                                          \
		.kind = KEEB_WID_RECT, .source = KEEB_SRC_NONE, .x = (kx), .y = (ky), .w = (kw),   \
		.h = (kh), .style = (kstyle)                                                       \
	}
#define W_RULE(kx, ky, kw)                                                                         \
	{                                                                                          \
		.kind = KEEB_WID_RULE, .source = KEEB_SRC_NONE, .x = (kx), .y = (ky), .w = (kw),   \
		.h = 1, .style = 0                                                                 \
	}
#define W_TEXT(kx, ky, kw, kh, ksrc, kfont, kalign)                                               \
	{                                                                                          \
		.kind = KEEB_WID_TEXT, .source = (ksrc), .x = (kx), .y = (ky), .w = (kw),          \
		.h = (kh), .style = KEEB_TEXT_STYLE(kfont, kalign)                                 \
	}
#define W_BAR(kx, ky, kw, kh, ksrc)                                                                \
	{                                                                                          \
		.kind = KEEB_WID_BAR, .source = (ksrc), .x = (kx), .y = (ky), .w = (kw),           \
		.h = (kh), .style = 0                                                              \
	}
#define W_BATTERY(kx, ky, ksrc)                                                                    \
	{                                                                                          \
		.kind = KEEB_WID_BATTERY, .source = (ksrc), .x = (kx), .y = (ky), .w = 17,         \
		.h = 9, .style = 0                                                                 \
	}
#define W_PIPS(kx, ky, kpip_w, kpip_h, geometry)                                                   \
	{                                                                                          \
		.kind = KEEB_WID_PIPS, .source = KEEB_SRC_LAYER_PIPS, .x = (kx), .y = (ky),        \
		.w = (kpip_w), .h = (kpip_h), .style = (geometry)                                  \
	}
#define W_BOLT(kx, ky)                                                                             \
	{                                                                                          \
		.kind = KEEB_WID_BOLT, .source = KEEB_SRC_NONE, .x = (kx), .y = (ky), .w = 7,      \
		.h = 9, .style = 0                                                                 \
	}
#define W_ART(kx, ky, kw, kh, kfit)                                                                \
	{                                                                                          \
		.kind = KEEB_WID_ART, .source = KEEB_SRC_LAYER_ART, .x = (kx), .y = (ky),          \
		.w = (kw), .h = (kh), .style = (kfit)                                              \
	}

#define SLOT(n) (KEEB_SRC_TEXT_BASE + (n))

#if KBEEB_UI_CENTRAL

#if !KBEEB_UI_PORTRAIT

/* Preset 0, central, landscape: the original "KEYBOARD SYSTEM" panel. */
static const struct keeb_widget central_landscape[] = {
	W_FRAME(0, 0, 160, 68, 4),
	W_TEXT(6, 3, 90, 0, SLOT(0), 0, 0),   /* header label */
	W_TEXT(96, 3, 58, 0, KEEB_SRC_LINK, 0, 2),
	W_RULE(4, 13, 152),
	W_FRAME(5, 16, 38, 32, 3),
	W_TEXT(5, 16, 38, 32, KEEB_SRC_LAYER_INDEX, 2, 1),
	W_PIPS(6, 51, 6, 3, KEEB_PIPS_SMALL),
	W_TEXT(48, 19, 50, 0, KEEB_SRC_LAYER_NAME, 1, 0),
	W_TEXT(48, 40, 50, 0, KEEB_SRC_LAYER_POS, 0, 0),
	W_TEXT(102, 16, 30, 0, SLOT(1), 0, 0), /* "LEFT" */
	W_TEXT(132, 16, 22, 0, KEEB_SRC_BATT_LEFT_PCT, 0, 2),
	W_BAR(102, 27, 52, 4, KEEB_SRC_BATT_LEFT),
	W_TEXT(102, 35, 30, 0, SLOT(2), 0, 0), /* "RIGHT" */
	W_TEXT(132, 35, 22, 0, KEEB_SRC_BATT_RIGHT_PCT, 0, 2),
	W_BAR(102, 46, 52, 4, KEEB_SRC_BATT_RIGHT),
	W_RULE(4, 55, 152),
	W_TEXT(6, 57, 60, 0, SLOT(3), 0, 0), /* "SYS. READY_" */
	W_TEXT(66, 57, 88, 0, KEEB_SRC_CHARGING, 0, 2),
	W_BOLT(145, 57),
};

#endif /* !KBEEB_UI_PORTRAIT */

#if KBEEB_UI_PORTRAIT

/* Preset 0, central, portrait: the original vertical panel. */
static const struct keeb_widget central_portrait[] = {
	W_FRAME(0, 0, 68, 160, 4),
	W_TEXT(5, 3, 34, 0, SLOT(0), 0, 0),
	W_TEXT(39, 3, 24, 0, KEEB_SRC_LINK_SHORT, 0, 2),
	W_RULE(4, 13, 60),
	W_FRAME(15, 17, 38, 32, 3),
	W_TEXT(15, 17, 38, 32, KEEB_SRC_LAYER_INDEX, 2, 1),
	W_TEXT(4, 53, 60, 0, KEEB_SRC_LAYER_NAME, 1, 1),
	W_TEXT(4, 70, 60, 0, KEEB_SRC_LAYER_POS, 0, 1),
	/* 6 pips of 7 px with a 3 px gap: keeb_ui_validate_widget() measures a
	 * pip row as count * (pip_w + gap), so the row has to start at or
	 * before 68 - 60 = 8 to be a table the configurator can write back. */
	W_PIPS(5, 82, 7, 4, KEEB_PIPS_LARGE),
	W_TEXT(7, 94, 16, 0, SLOT(1), 0, 0),
	W_TEXT(25, 94, 28, 0, KEEB_SRC_BATT_LEFT_PCT, 0, 2),
	W_BAR(7, 105, 46, 4, KEEB_SRC_BATT_LEFT),
	W_TEXT(7, 114, 16, 0, SLOT(2), 0, 0),
	W_TEXT(25, 114, 28, 0, KEEB_SRC_BATT_RIGHT_PCT, 0, 2),
	W_BAR(7, 125, 46, 4, KEEB_SRC_BATT_RIGHT),
	W_RULE(4, 138, 60),
	W_TEXT(4, 142, 60, 0, KEEB_SRC_CHARGING, 0, 1),
	W_TEXT(4, 151, 60, 0, SLOT(3), 0, 1),
};

#endif /* KBEEB_UI_PORTRAIT */

#if !KBEEB_UI_PORTRAIT

/* Preset 1, central: layer + connected device only. */
static const struct keeb_widget central_minimal_landscape[] = {
	W_FRAME(0, 0, 160, 68, 4),
	W_FRAME(6, 6, 44, 40, 3),
	W_TEXT(6, 6, 44, 40, KEEB_SRC_LAYER_INDEX, 2, 1),
	W_TEXT(56, 10, 98, 0, KEEB_SRC_LAYER_NAME, 1, 0),
	W_TEXT(56, 34, 98, 0, KEEB_SRC_LAYER_POS, 0, 0),
	W_TEXT(56, 50, 50, 0, SLOT(0), 0, 0),
	W_TEXT(110, 50, 44, 0, KEEB_SRC_DEVICE_ID, 2, 2),
};

#endif /* !KBEEB_UI_PORTRAIT */

#if KBEEB_UI_PORTRAIT

static const struct keeb_widget central_minimal_portrait[] = {
	W_FRAME(0, 0, 68, 160, 4),
	W_FRAME(6, 6, 56, 40, 3),
	W_TEXT(6, 6, 56, 40, KEEB_SRC_LAYER_INDEX, 2, 1),
	W_TEXT(4, 52, 60, 0, KEEB_SRC_LAYER_NAME, 1, 1),
	W_TEXT(4, 104, 60, 0, SLOT(0), 0, 1),
	W_TEXT(4, 116, 60, 40, KEEB_SRC_DEVICE_ID, 2, 1),
};

#endif /* KBEEB_UI_PORTRAIT */

#else /* peripheral half */

#if !KBEEB_UI_PORTRAIT

/* Preset 0, peripheral: the layer's artwork with a device strip beneath it. */
static const struct keeb_widget peripheral_landscape[] = {
#if KBEEB_UI_ART_LINKED
	W_ART(0, 0, 160, 68, KEEB_ART_CENTRE),
#endif
	W_FRAME(0, 0, 160, 68, 4),
	W_RECT(1, 50, 158, 17, KEEB_RECT_PAPER),
	W_RULE(1, 50, 158),
	W_TEXT(5, 53, 60, 0, SLOT(0), 0, 0),
	W_TEXT(100, 53, 54, 0, KEEB_SRC_DEVICE_ID, 0, 2),
};

#endif /* !KBEEB_UI_PORTRAIT */

#if KBEEB_UI_PORTRAIT

static const struct keeb_widget peripheral_portrait[] = {
#if KBEEB_UI_ART_LINKED
	W_ART(0, 0, 68, 160, KEEB_ART_CENTRE),
#endif
	W_FRAME(0, 0, 68, 160, 4),
	W_RECT(1, 141, 66, 18, KEEB_RECT_PAPER),
	W_RULE(1, 141, 66),
	W_TEXT(5, 145, 28, 0, SLOT(0), 0, 0),
	W_TEXT(33, 145, 30, 0, KEEB_SRC_DEVICE_ID, 0, 2),
};

#endif /* KBEEB_UI_PORTRAIT */

#if !KBEEB_UI_PORTRAIT

/* Preset 1, peripheral: the connected device, nothing else. */
static const struct keeb_widget peripheral_device_only_landscape[] = {
	W_FRAME(0, 0, 160, 68, 4),
	W_TEXT(4, 8, 152, 0, SLOT(0), 0, 1),
	W_TEXT(4, 24, 152, 36, KEEB_SRC_DEVICE_ID, 2, 1),
};

#endif /* !KBEEB_UI_PORTRAIT */

#if KBEEB_UI_PORTRAIT

static const struct keeb_widget peripheral_device_only_portrait[] = {
	W_FRAME(0, 0, 68, 160, 4),
	W_TEXT(4, 20, 60, 0, SLOT(0), 0, 1),
	W_TEXT(4, 60, 60, 44, KEEB_SRC_DEVICE_ID, 2, 1),
};

#endif /* KBEEB_UI_PORTRAIT */

#endif /* role */

/* Only the tables for the orientation this build composes in are compiled:
 * an unused static table is a -Wunused-variable error under -Werror. */
#if KBEEB_UI_PORTRAIT
#define PRESET(name) name##_portrait
#else
#define PRESET(name) name##_landscape
#endif

#define PRESET_INIT(pname, pid, plabel, t0, t1, t2, t3)                                           \
	[pid] = {                                                                                    \
		.name = plabel,                                                                      \
		.widgets = PRESET(pname),                                                            \
		.count = ARRAY_SIZE(PRESET(pname)),                                                  \
		.texts = {t0, t1, t2, t3},                                                           \
	}

static const struct keeb_ui_preset presets[] = {
#if KBEEB_UI_CENTRAL
	PRESET_INIT(central, 0, "STATUS", "KEYBOARD SYSTEM", "LEFT", "RIGHT", "SYS. READY_"),
	PRESET_INIT(central_minimal, 1, "MINIMAL", "DEVICE", "", "", ""),
#else
	PRESET_INIT(peripheral, 0, "ART + DEVICE", "DEVICE", "", "", ""),
	PRESET_INIT(peripheral_device_only, 1, "DEVICE", "", "", "", ""),
#endif
};

/* --------------------------------------------------------------------------
 * Model state
 * -------------------------------------------------------------------------- */

static struct keeb_widget widgets[KBEEB_UI_WIDGET_MAX];
static uint8_t widget_count;
static char text_slots[KBEEB_UI_TEXT_SLOTS][KBEEB_UI_TEXT_MAX + 1];
static int16_t value_slots[KBEEB_UI_VALUE_SLOTS];
static uint8_t preset_id;
static bool blank_next;

static struct k_mutex model_lock;

uint8_t keeb_ui_preset_count(void) { return ARRAY_SIZE(presets); }

const struct keeb_ui_preset *keeb_ui_preset(uint8_t id) {
	return (id < ARRAY_SIZE(presets)) ? &presets[id] : NULL;
}

uint8_t keeb_ui_widget_count(void) { return widget_count; }

const struct keeb_widget *keeb_ui_widgets(void) { return widgets; }

uint8_t keeb_ui_preset_id(void) { return preset_id; }

int keeb_ui_set_widgets(const struct keeb_widget *next, uint8_t count) {
	if (count > KBEEB_UI_WIDGET_MAX) {
		return -KEEB_ERR_NO_SPACE;
	}

	/* Validate the whole table before replacing anything: a half-applied
	 * layout is exactly as unusable on the panel as it is on the keymap. */
	for (uint8_t i = 0; i < count; i++) {
		int err = keeb_ui_validate_widget(&next[i]);

		if (err) {
			return err;
		}
	}

	k_mutex_lock(&model_lock, K_FOREVER);
	memcpy(widgets, next, count * sizeof(*next));
	for (uint8_t i = count; i < KBEEB_UI_WIDGET_MAX; i++) {
		widgets[i].kind = KEEB_WID_NONE;
	}
	widget_count = count;
	preset_id = KBEEB_PRESET_CUSTOM;
	k_mutex_unlock(&model_lock);

	keeb_ui_request_draw();

	return 0;
}

int keeb_ui_apply_preset(uint8_t id) {
	const struct keeb_ui_preset *preset = keeb_ui_preset(id);

	if (!preset) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	if (preset->count > KBEEB_UI_WIDGET_MAX) {
		return -KEEB_ERR_NO_SPACE;
	}

	k_mutex_lock(&model_lock, K_FOREVER);

	memcpy(widgets, preset->widgets, preset->count * sizeof(*widgets));
	widget_count = preset->count;
	preset_id = id;

	for (uint8_t s = 0; s < KBEEB_UI_TEXT_SLOTS; s++) {
		snprintf(text_slots[s], KBEEB_UI_TEXT_MAX + 1, "%s",
			 preset->texts[s] ? preset->texts[s] : "");
	}

	k_mutex_unlock(&model_lock);

	keeb_ui_request_draw();

	return 0;
}

int keeb_ui_set_text(uint8_t slot, const char *text, uint8_t len) {
	if (slot >= KBEEB_UI_TEXT_SLOTS) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	if (len > KBEEB_UI_TEXT_MAX) {
		return -KEEB_ERR_TOO_BIG;
	}

	k_mutex_lock(&model_lock, K_FOREVER);
	memcpy(text_slots[slot], text, len);
	text_slots[slot][len] = '\0';
	k_mutex_unlock(&model_lock);

	keeb_ui_request_draw();

	return 0;
}

int keeb_ui_get_text(uint8_t slot, char *out, uint8_t out_len) {
	if (slot >= KBEEB_UI_TEXT_SLOTS) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	k_mutex_lock(&model_lock, K_FOREVER);
	snprintf(out, out_len, "%s", text_slots[slot]);
	k_mutex_unlock(&model_lock);

	return 0;
}

int keeb_ui_set_value(uint8_t slot, int16_t value) {
	if (slot >= KBEEB_UI_VALUE_SLOTS) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	k_mutex_lock(&model_lock, K_FOREVER);
	value_slots[slot] = value;
	k_mutex_unlock(&model_lock);

	keeb_ui_request_draw();

	return 0;
}

int16_t keeb_ui_get_value(uint8_t slot) {
	if (slot >= KBEEB_UI_VALUE_SLOTS) {
		return 0;
	}

	k_mutex_lock(&model_lock, K_FOREVER);
	int16_t v = value_slots[slot];
	k_mutex_unlock(&model_lock);

	return v;
}

void keeb_ui_blank_once(void) {
	blank_next = true;
	keeb_ui_request_draw();
}

bool keeb_ui_art_available(void) { return KBEEB_UI_ART_LINKED; }

/* --------------------------------------------------------------------------
 * Validation
 * -------------------------------------------------------------------------- */

static bool source_known(uint8_t source) {
	switch (source) {
	case KEEB_SRC_NONE:
	case KEEB_SRC_LAYER_INDEX:
	case KEEB_SRC_LAYER_NAME:
	case KEEB_SRC_LAYER_POS:
	case KEEB_SRC_LAYER_PIPS:
	case KEEB_SRC_LAYER_ART:
	case KEEB_SRC_BATT_LEFT:
	case KEEB_SRC_BATT_LEFT_PCT:
	case KEEB_SRC_BATT_RIGHT:
	case KEEB_SRC_BATT_RIGHT_PCT:
	case KEEB_SRC_LINK:
	case KEEB_SRC_LINK_SHORT:
	case KEEB_SRC_HOST:
	case KEEB_SRC_CHARGING:
	case KEEB_SRC_DEVICE_ID:
	case KEEB_SRC_DEVICE_NAME:
		return true;
	default:
		if (source >= KEEB_SRC_TEXT_BASE && source < KEEB_SRC_TEXT_BASE + KBEEB_UI_TEXT_SLOTS) {
			return true;
		}

		if (source >= KEEB_SRC_VALUE_BASE &&
		    source < KEEB_SRC_VALUE_BASE + KBEEB_UI_VALUE_SLOTS) {
			return true;
		}

		return false;
	}
}

/** A kind only accepts the sources that can actually feed it: a bar that names
 * a layer name is a mistake, not a drawing instruction. */
static bool kind_source_ok(const struct keeb_widget *w) {
	switch (w->kind) {
	case KEEB_WID_TEXT:
		return w->source != KEEB_SRC_NONE && w->source != KEEB_SRC_LAYER_PIPS &&
		       w->source != KEEB_SRC_LAYER_ART && w->source != KEEB_SRC_BATT_LEFT &&
		       w->source != KEEB_SRC_BATT_RIGHT;
	case KEEB_WID_BAR:
	case KEEB_WID_BATTERY:
		return w->source == KEEB_SRC_BATT_LEFT || w->source == KEEB_SRC_BATT_RIGHT ||
		       (w->source >= KEEB_SRC_VALUE_BASE &&
			w->source < KEEB_SRC_VALUE_BASE + KBEEB_UI_VALUE_SLOTS);
	case KEEB_WID_PIPS:
		return w->source == KEEB_SRC_LAYER_PIPS;
	case KEEB_WID_ART:
		return w->source == KEEB_SRC_LAYER_ART;
	default:
		return w->source == KEEB_SRC_NONE;
	}
}

int keeb_ui_validate_widget(const struct keeb_widget *w) {
	if (w->kind >= KEEB_WID_COUNT) {
		return -KEEB_ERR_BAD_WIDGET;
	}

	/* Not a mistake in the payload - this image has no artwork to draw. */
	if (!KBEEB_UI_ART_LINKED &&
	    (w->kind == KEEB_WID_ART || w->source == KEEB_SRC_LAYER_ART)) {
		return -KEEB_ERR_BAD_WIDGET;
	}

	if (!source_known(w->source) || !kind_source_ok(w)) {
		return -KEEB_ERR_BAD_WIDGET;
	}

	/* Coordinates live in the logical space; w == 0 on a text widget means
	 * "natural width", which the primitives already handle. */
	if (w->x >= KBEEB_UI_W || w->y >= KBEEB_UI_H) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	if ((uint16_t)w->x + w->w > KBEEB_UI_W || (uint16_t)w->y + w->h > KBEEB_UI_H) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	if (w->kind == KEEB_WID_PIPS) {
		uint16_t gap = (w->style == KEEB_PIPS_LARGE) ? 3 : 2;
		uint16_t row_w = KBEEB_LAYER_COUNT * (w->w + gap);

		if ((uint16_t)w->x + row_w > KBEEB_UI_W) {
			return -KEEB_ERR_OUT_OF_RANGE;
		}
	}

	return 0;
}

/* --------------------------------------------------------------------------
 * Value resolution
 * -------------------------------------------------------------------------- */

static const lv_font_t *font_for(uint8_t style) {
	switch (KEEB_STYLE_FONT(style)) {
	case 1:
		return KBEEB_FONT_BODY;
	case 2:
		return KBEEB_FONT_DIGIT;
	default:
		return KBEEB_FONT_SMALL;
	}
}

static lv_text_align_t align_for(uint8_t style) {
	switch (KEEB_STYLE_ALIGN(style)) {
	case 1:
		return LV_TEXT_ALIGN_CENTER;
	case 2:
		return LV_TEXT_ALIGN_RIGHT;
	default:
		return LV_TEXT_ALIGN_LEFT;
	}
}

static const char *text_for(const struct keeb_ui_state *st, uint8_t source) {
	switch (source) {
	case KEEB_SRC_LAYER_INDEX:
		return st->layer_str;
	case KEEB_SRC_LAYER_NAME:
		return st->layer_name;
	case KEEB_SRC_LAYER_POS:
		return st->pos_str;
	case KEEB_SRC_BATT_LEFT_PCT:
		return st->left_pct_str;
	case KEEB_SRC_BATT_RIGHT_PCT:
		return st->right_pct_str;
	case KEEB_SRC_LINK:
		return st->link_str;
	case KEEB_SRC_LINK_SHORT:
		return st->link_short_str;
	case KEEB_SRC_HOST:
		return st->host_str;
	case KEEB_SRC_CHARGING:
		return st->charging_str;
	case KEEB_SRC_DEVICE_ID:
		return st->device_str;
	case KEEB_SRC_DEVICE_NAME:
		return st->device_name[0] ? st->device_name : "--";
	default:
		break;
	}

	if (source >= KEEB_SRC_TEXT_BASE && source < KEEB_SRC_TEXT_BASE + KBEEB_UI_TEXT_SLOTS) {
		return st->text[source - KEEB_SRC_TEXT_BASE];
	}

	if (source >= KEEB_SRC_VALUE_BASE && source < KEEB_SRC_VALUE_BASE + KBEEB_UI_VALUE_SLOTS) {
		return st->value_str[source - KEEB_SRC_VALUE_BASE];
	}

	return "";
}

static bool percent_for(const struct keeb_ui_state *st, uint8_t source, uint8_t *percent) {
	switch (source) {
	case KEEB_SRC_BATT_LEFT:
		*percent = st->left_level;
		return st->left_valid;
	case KEEB_SRC_BATT_RIGHT:
		*percent = st->right_level;
		return st->right_valid;
	default:
		break;
	}

	if (source >= KEEB_SRC_VALUE_BASE && source < KEEB_SRC_VALUE_BASE + KBEEB_UI_VALUE_SLOTS) {
		int16_t v = st->value[source - KEEB_SRC_VALUE_BASE];

		/* A bar is a percentage: clamp instead of drawing a bar that
		 * lies about how full something is. */
		*percent = (v < 0) ? 0 : (v > 100 ? 100 : (uint8_t)v);
		return true;
	}

	*percent = 0;
	return false;
}

/* --------------------------------------------------------------------------
 * Draw pass
 * -------------------------------------------------------------------------- */

static void draw_widget(struct keeb_ctx *ctx, const struct keeb_widget *w,
			const struct keeb_ui_state *st) {
	uint8_t percent = 0;
	bool bar_valid = false;

	switch (w->kind) {
	case KEEB_WID_FRAME:
		keeb_frame(ctx, w->x, w->y, w->w, w->h, w->style);
		break;

	case KEEB_WID_RECT:
		keeb_fill(ctx, w->x, w->y, w->w, w->h,
			  (w->style & KEEB_RECT_PAPER) ? KBEEB_PAPER : KBEEB_INK);
		break;

	case KEEB_WID_RULE:
		keeb_rule(ctx, w->x, w->y, w->w);
		break;

	case KEEB_WID_TEXT: {
		const lv_font_t *font = font_for(w->style);
		lv_text_align_t align = align_for(w->style);
		const char *text = text_for(st, w->source);

		if (!text || !text[0]) {
			break;
		}

		if (w->h > 0 && align == LV_TEXT_ALIGN_CENTER) {
			keeb_text_centered_in(ctx, font, w->x, w->y, w->w, w->h, text);
			break;
		}

		/* A layer name longer than its box drops to the small font
		 * rather than being clipped - ZMK allows names this panel's
		 * body font cannot show at any width. */
		if (w->source == KEEB_SRC_LAYER_NAME &&
		    lv_text_get_width(text, strlen(text), font, 0) > w->w) {
			font = KBEEB_FONT_SMALL;
		}

		keeb_text(ctx, font, w->x, w->y, w->w, align, text);
		break;
	}

	case KEEB_WID_BAR:
		/* Resolve before the call: argument evaluation order is not a
		 * thing to rely on when one argument writes the other's value. */
		bar_valid = percent_for(st, w->source, &percent);
		keeb_bar(ctx, w->x, w->y, w->w, w->h, percent, bar_valid);
		break;

	case KEEB_WID_BATTERY:
		bar_valid = percent_for(st, w->source, &percent);
		keeb_battery(ctx, w->x, w->y, percent, bar_valid);
		break;

	case KEEB_WID_PIPS: {
		uint16_t gap = (w->style == KEEB_PIPS_LARGE) ? 3 : 2;

		keeb_pips(ctx, w->x, w->y, KBEEB_LAYER_COUNT, st->layer, w->w, w->h, gap);
		break;
	}

	case KEEB_WID_BOLT:
		if (st->charging) {
			keeb_bolt(ctx, w->x, w->y);
		}
		break;

	case KEEB_WID_ART: {
#if KBEEB_UI_ART_LINKED
		const lv_image_dsc_t *art = keeb_layer_art(st->art_layer);

		if (!art || art->header.w == 0 || art->header.h == 0) {
			break;
		}

		int16_t x = (int16_t)(w->x + (w->w - (int16_t)art->header.w) / 2);
		int16_t y = (w->style == KEEB_ART_BOTTOM)
				    ? (int16_t)(w->y + w->h - art->header.h)
				    : (int16_t)(w->y + (w->h - (int16_t)art->header.h) / 2);

		lv_area_t coords = {x, y, x + (int16_t)art->header.w - 1,
				    y + (int16_t)art->header.h - 1};

		/* A8 stencil blended in the current ink colour, so
		 * CONFIG_ZMK_DISPLAY_INVERT flips art together with the frame. */
		lv_draw_image_dsc_t dsc;

		lv_draw_image_dsc_init(&dsc);
		dsc.src = art;
		dsc.recolor = KBEEB_INK;
		dsc.recolor_opa = LV_OPA_COVER;

		lv_draw_image(&ctx->layer, &dsc, &coords);
		break;
#else
		break; /* validated out: unreachable unless the Kconfig changed */
#endif
	}

	default:
		break;
	}
}

static void state_format(struct keeb_ui_state *st) {
	snprintf(st->layer_str, sizeof(st->layer_str), "%02u", st->layer + 1);
	snprintf(st->pos_str, sizeof(st->pos_str), "LAYER %u / %u", st->layer + 1,
		 KBEEB_LAYER_COUNT);

	if (st->left_valid) {
		snprintf(st->left_pct_str, sizeof(st->left_pct_str), "%u%%", st->left_level);
	} else {
		snprintf(st->left_pct_str, sizeof(st->left_pct_str), "--");
	}

	if (st->right_valid) {
		snprintf(st->right_pct_str, sizeof(st->right_pct_str), "%u%%", st->right_level);
	} else {
		snprintf(st->right_pct_str, sizeof(st->right_pct_str), "--");
	}

	snprintf(st->link_str, sizeof(st->link_str), "LINK: %s",
		 st->peer_connected ? "OK" : "--");
	snprintf(st->link_short_str, sizeof(st->link_short_str), "%s",
		 st->peer_connected ? "LINK" : "--");
	snprintf(st->host_str, sizeof(st->host_str), "HOST: %s",
		 st->host_connected ? "READY" : "--");
	snprintf(st->charging_str, sizeof(st->charging_str), "%s",
		 st->charging ? "CHARGING" : st->host_str);

	if (st->device_id == KEEB_DEV_USB) {
		snprintf(st->device_str, sizeof(st->device_str), "USB");
	} else if (st->device_id == KEEB_DEV_NONE) {
		snprintf(st->device_str, sizeof(st->device_str), "--");
	} else {
		snprintf(st->device_str, sizeof(st->device_str), "%u", st->device_id);
	}

	for (uint8_t i = 0; i < KBEEB_UI_VALUE_SLOTS; i++) {
		snprintf(st->value_str[i], sizeof(st->value_str[i]), "%d", st->value[i]);
	}
}

void keeb_ui_render(struct keeb_ctx *ctx, struct keeb_ui_state *st) {
	/* Copy the host-owned slots out under the lock: a text slot written by
	 * the engine while this runs must not land mid-string in a live frame. */
	k_mutex_lock(&model_lock, K_FOREVER);

	memcpy(st->text, text_slots, sizeof(st->text));

	for (uint8_t i = 0; i < KBEEB_UI_VALUE_SLOTS; i++) {
		st->value[i] = value_slots[i];
	}

	uint8_t count = widget_count;

	k_mutex_unlock(&model_lock);

	state_format(st);

	if (blank_next) {
		blank_next = false;
		return; /* keeb_ui.c already painted paper before calling us */
	}

	for (uint8_t i = 0; i < count; i++) {
		draw_widget(ctx, &widgets[i], st);
	}
}

/* --------------------------------------------------------------------------
 * Init
 * -------------------------------------------------------------------------- */

static int keeb_ui_model_init(void) {
	k_mutex_init(&model_lock);

#if KBEEB_UI_CENTRAL
	keeb_ui_apply_preset(0);
#else
	/* A preset number that no longer exists must still leave a usable panel. */
	if (keeb_ui_apply_preset(CONFIG_KBEEB_UI_PERIPHERAL_PRESET)) {
		keeb_ui_apply_preset(0);
	}
#endif

	return 0;
}

/* Runs before main() calls settings_load(), so a saved table lands *after* this
 * and replaces the preset (see display/keeb_display.c). */
SYS_INIT(keeb_ui_model_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);
