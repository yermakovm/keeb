/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * The status screen's widget model: what the panels draw *from*.
 *
 * Before this, the panels were imperative - every coordinate a #define in
 * panel_central.c / panel_peripheral.c. The model makes the same picture data:
 * a bounded table of drawing primitives (struct keeb_widget, defined in
 * proto/keeb_tlv.h because it is also the wire format) plus a draw pass that
 * paints that table out of a snapshot of ZMK's state.
 *
 * Three rules the model enforces, because they are what keep a host-written
 * layout from becoming an unusable keyboard:
 *
 *   - A widget names a *source*, never a value. Layer, battery, link, charging
 *     and the connected device are read from ZMK at draw time, so the panel
 *     cannot be made to lie about the keyboard's state.
 *   - The table is bounded (KBEEB_UI_WIDGET_MAX) and every entry is validated
 *     against the panel's own geometry before it is accepted.
 *   - The only values a host may write are the text slots and the number slots
 *     a widget explicitly opts into, and they live in fixed-size buffers.
 *
 * Threading: the table, the text slots and the number slots are written from
 * the engine's work queue and read from the display work queue. The model owns
 * a mutex around them; a draw copies them into the panel's own snapshot while
 * holding it, so a render never sees a half-written string.
 */

#pragma once

#include <zephyr/kernel.h>
#include <zephyr/types.h>

#include <lvgl.h>

#include "../../../../proto/keeb_tlv.h"
#include "keeb_ui.h"
#include "panels.h" /* KBEEB_LAYER_NAME_MAX */

/** How many primitives the panel can hold, and how much a host may write. */
#define KBEEB_UI_WIDGET_MAX 24
#define KBEEB_UI_TEXT_SLOTS 8
#define KBEEB_UI_TEXT_MAX 24
#define KBEEB_UI_VALUE_SLOTS 4

/** Which half this build is. Same rule the config engine uses: an unsplitted
 * board is its own central, and only the central owns the readouts. */
#if !IS_ENABLED(CONFIG_ZMK_SPLIT) || IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
#define KBEEB_UI_CENTRAL 1
#else
#define KBEEB_UI_CENTRAL 0
#endif

/** keeb_display_hdr.preset value once a host has replaced the built-in table. */
#define KBEEB_PRESET_CUSTOM 0xffu

/** Longest connected-device name the model can carry. ZMK's own endpoint
 * string is ZMK_ENDPOINT_STR_LEN (10); a BLE peer profile name can be longer. */
#define KBEEB_DEVICE_NAME_MAX 16

/** Everything one panel shows. The panel fills the ZMK-owned fields, the model
 * fills the host-owned ones, and keeb_ui_render() formats the strings.
 *
 * Every string a draw hands to LVGL lives here, not on a stack: LVGL defers
 * glyph rendering until the canvas layer is finished, which happens *after*
 * the draw callback returned (see panel_central.c).
 */
struct keeb_ui_state {
	/* ZMK-owned: read from ZMK by the panel at draw time. */
	uint8_t layer;
	char layer_name[KBEEB_LAYER_NAME_MAX];
	uint8_t left_level;
	uint8_t right_level;
	bool left_valid;
	bool right_valid;
	bool peer_connected;
	bool host_connected;
	bool charging;
	/** KEEB_DEV_NONE, KEEB_DEV_USB, or 1..N for a BLE profile. */
	uint8_t device_id;
	char device_name[KBEEB_DEVICE_NAME_MAX];
	/** Which layer's artwork KEEB_SRC_LAYER_ART draws. On the peripheral
	 * this is the layer the central pushed, not a local keymap layer. */
	uint8_t art_layer;

	/* Host-owned: copied out of the model at the start of every render. */
	char text[KBEEB_UI_TEXT_SLOTS][KBEEB_UI_TEXT_MAX + 1];
	int16_t value[KBEEB_UI_VALUE_SLOTS];

	/* Formatted once per render by keeb_ui_state_format(). */
	char layer_str[4];
	char pos_str[16];
	char left_pct_str[6];
	char right_pct_str[6];
	char link_str[10];
	char link_short_str[5];
	char host_str[12];
	char charging_str[12];
	char device_str[8];
	char value_str[KBEEB_UI_VALUE_SLOTS][8];
};

/** One built-in layout: a widget table plus the strings its slots need. */
struct keeb_ui_preset {
	const char *name;
	const struct keeb_widget *widgets;
	uint8_t count;
	const char *texts[KBEEB_UI_TEXT_SLOTS];
};

/** Presets this build ships: 0 is the panel's own default look. */
uint8_t keeb_ui_preset_count(void);
const struct keeb_ui_preset *keeb_ui_preset(uint8_t id);

/** Current table (read-only view), how many entries it has, and which preset
 * it came from (KBEEB_PRESET_CUSTOM once a host wrote its own). */
uint8_t keeb_ui_widget_count(void);
const struct keeb_widget *keeb_ui_widgets(void);
uint8_t keeb_ui_preset_id(void);

/** Replace the whole table. `count` may be 0 (a blank panel). */
int keeb_ui_set_widgets(const struct keeb_widget *widgets, uint8_t count);

/** Restore a built-in preset (its table and its slot strings). */
int keeb_ui_apply_preset(uint8_t id);

/** Write one host-owned slot. Returns 0 or a negative KEEB_ERR_*. */
int keeb_ui_set_text(uint8_t slot, const char *text, uint8_t len);
int keeb_ui_set_value(uint8_t slot, int16_t value);

/** Read a slot back (for the DISPLAY dump). Returns 0 or KEEB_ERR_OUT_OF_RANGE. */
int keeb_ui_get_text(uint8_t slot, char *out, uint8_t out_len);
int16_t keeb_ui_get_value(uint8_t slot);

/** Validate one widget against this panel's geometry without applying it. */
int keeb_ui_validate_widget(const struct keeb_widget *w);

/** Paint the table into ctx using `st` for every value. Safe from any context
 * that already runs on the display work queue (the panel draw callback does). */
void keeb_ui_render(struct keeb_ctx *ctx, struct keeb_ui_state *st);

/** Skip the table on the next render only: the "blank the glass" operation. */
void keeb_ui_blank_once(void);

/** True when this image links the layer artwork, i.e. whether KEEB_WID_ART can
 * be drawn here at all. Reported to the configurator in keeb_display_info. */
bool keeb_ui_art_available(void);
