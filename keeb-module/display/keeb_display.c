/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * See keeb_display.h. Two halves to this file: the protocol side (validate a
 * payload, then apply it) and the persistence side (a settings subtree of our
 * own, "keebui").
 */

#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include <stdio.h>
#include <string.h>

#if IS_ENABLED(CONFIG_SETTINGS)
#include <zephyr/settings/settings.h>
#endif

#include "../boards/shields/keeb/ui/keeb_ui.h"
#include "../boards/shields/keeb/ui/widget_model.h"
#include "../proto/keeb_tlv.h"
#include "keeb_display.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#if IS_ENABLED(CONFIG_KBEEB_UI)

/* --------------------------------------------------------------------------
 * What gets saved
 * --------------------------------------------------------------------------
 * One blob per concern, so a corrupt or truncated entry costs one thing and
 * not the whole panel. struct keeb_widget is the wire record, so the settings
 * blob, the TLV payload and the configurator's model are the same layout.
 */

struct keeb_ui_saved_table {
	uint8_t count;
	uint8_t preset;
	uint8_t rsvd[2];
	struct keeb_widget widgets[KBEEB_UI_WIDGET_MAX];
};

struct keeb_ui_saved_text {
	char text[KBEEB_UI_TEXT_SLOTS][KBEEB_UI_TEXT_MAX + 1];
};

#define KEEB_UI_SETTINGS_TABLE "keebui/table"
#define KEEB_UI_SETTINGS_TEXT "keebui/text"

static bool dirty;

/* Staged settings load: applied in the commit callback, never mid-scan. */
static struct keeb_ui_saved_table pending_table;
static struct keeb_ui_saved_text pending_text;
static bool pending_has_table;
static bool pending_has_text;

bool keeb_display_dirty(void) { return dirty; }

uint32_t keeb_display_capabilities(void) { return KEEB_INFO_F_DISPLAY; }

/* --------------------------------------------------------------------------
 * Read side
 * -------------------------------------------------------------------------- */

void keeb_display_info(struct keeb_display_info *info) {
	memset(info, 0, sizeof(*info));

	/* The engine is central-only, so every firmware that answers this owns
	 * its own panel. */
	info->editable = 1;
	info->preset_count = keeb_ui_preset_count();
	info->widget_max = KBEEB_UI_WIDGET_MAX;
	info->text_slots = KBEEB_UI_TEXT_SLOTS;
	info->text_max = KBEEB_UI_TEXT_MAX;
	info->value_slots = KBEEB_UI_VALUE_SLOTS;
	info->kind_max = KEEB_WID_COUNT;
	info->source_max = KEEB_SRC_VALUE_BASE + KBEEB_UI_VALUE_SLOTS - 1;
	info->logical_w = KBEEB_UI_W;
	info->logical_h = KBEEB_UI_H;
	info->panel_w = KBEEB_PANEL_W;
	info->panel_h = KBEEB_PANEL_H;
	info->rotation = KBEEB_UI_ROTATION_DEG;
	info->widget_size = sizeof(struct keeb_widget);
	info->flags = keeb_ui_art_available() ? KEEB_DISPLAY_INFO_F_ART : 0;
	info->layers = KBEEB_LAYER_COUNT;
}

int keeb_display_names(struct keeb_tlv_msg *msg) {
	uint8_t count = keeb_ui_preset_count();

	for (uint8_t id = 0; id < count; id++) {
		const struct keeb_ui_preset *preset = keeb_ui_preset(id);

		if (!preset) {
			continue;
		}

		uint8_t name_len = (uint8_t)strlen(preset->name);
		struct keeb_preset_name *rec = keeb_tlv_rec_add(
				msg, KEEB_T_PRESET_NAME,
				(uint16_t)(sizeof(*rec) + name_len));

		if (!rec) {
			return -KEEB_ERR_TOO_BIG;
		}

		rec->preset = id;
		rec->name_len = name_len;
		memcpy(((uint8_t *)rec) + sizeof(*rec), preset->name, name_len);
	}

	return 0;
}

int keeb_display_dump(struct keeb_tlv_msg *msg) {
	uint8_t count = keeb_ui_widget_count();
	const struct keeb_widget *widgets = keeb_ui_widgets();

	struct keeb_display_hdr *hdr = keeb_tlv_rec_add(
			msg, KEEB_T_DISPLAY,
			(uint16_t)(sizeof(*hdr) + count * sizeof(struct keeb_widget)));

	if (!hdr) {
		return -KEEB_ERR_TOO_BIG;
	}

	hdr->count = count;
	hdr->preset = keeb_ui_preset_id();
	hdr->flags = dirty ? KEEB_DISPLAY_F_DIRTY : 0;

	memcpy(((uint8_t *)hdr) + sizeof(*hdr), widgets, count * sizeof(*widgets));

	/* Slots ride as their own records, the same way a layer dump carries
	 * one name record per layer: no nested records in the codec. */
	for (uint8_t slot = 0; slot < KBEEB_UI_TEXT_SLOTS; slot++) {
		char text[KBEEB_UI_TEXT_MAX + 1];

		if (keeb_ui_get_text(slot, text, sizeof(text))) {
			continue;
		}

		uint8_t len = (uint8_t)strlen(text);
		struct keeb_text_slot *rec =
				keeb_tlv_rec_add(msg, KEEB_T_TEXT_SET, (uint16_t)(sizeof(*rec) + len));

		if (!rec) {
			return -KEEB_ERR_TOO_BIG;
		}

		rec->slot = slot;
		rec->len = len;
		memcpy(((uint8_t *)rec) + sizeof(*rec), text, len);
	}

	for (uint8_t slot = 0; slot < KBEEB_UI_VALUE_SLOTS; slot++) {
		struct keeb_value_slot *rec =
				keeb_tlv_rec_add(msg, KEEB_T_VALUE_SET, sizeof(*rec));

		if (!rec) {
			return -KEEB_ERR_TOO_BIG;
		}

		rec->slot = slot;
		rec->rsvd = 0;
		rec->value = keeb_ui_get_value(slot);
	}

	return 0;
}

/* --------------------------------------------------------------------------
 * Write side
 * -------------------------------------------------------------------------- */

int keeb_display_set_table(const uint8_t *data, uint16_t len, uint16_t *applied) {
	if (len < sizeof(struct keeb_display_hdr)) {
		return -KEEB_ERR_BAD_LEN;
	}

	struct keeb_display_hdr hdr;

	memcpy(&hdr, data, sizeof(hdr));

	if (hdr.count > KBEEB_UI_WIDGET_MAX) {
		return -KEEB_ERR_NO_SPACE;
	}

	if (len != sizeof(hdr) + hdr.count * sizeof(struct keeb_widget)) {
		return -KEEB_ERR_BAD_LEN;
	}

	const struct keeb_widget *widgets = (const struct keeb_widget *)(data + sizeof(hdr));

	/* keeb_ui_set_widgets validates every entry before replacing any, so
	 * a table this firmware cannot draw is refused whole. */
	int err = keeb_ui_set_widgets(widgets, hdr.count);

	if (err) {
		return err;
	}

	dirty = true;
	*applied = hdr.count;

	LOG_INF("panel: %u widget(s) applied", hdr.count);

	return 0;
}

int keeb_display_set_widget(const uint8_t *data, uint16_t len) {
	if (len < sizeof(struct keeb_widget_set) + sizeof(struct keeb_widget)) {
		return -KEEB_ERR_BAD_LEN;
	}

	struct keeb_widget_set set;

	memcpy(&set, data, sizeof(set));

	struct keeb_widget next[KBEEB_UI_WIDGET_MAX];
	uint8_t count = keeb_ui_widget_count();

	memcpy(next, keeb_ui_widgets(), sizeof(next));

	if (set.index > count) {
		return -KEEB_ERR_OUT_OF_RANGE; /* one past the end = append */
	}

	memcpy(&next[set.index], data + sizeof(set), sizeof(struct keeb_widget));

	if (set.index == count) {
		count++;
	}

	int err = keeb_ui_set_widgets(next, count);

	if (err) {
		return err;
	}

	dirty = true;

	return 0;
}

int keeb_display_set_text(const uint8_t *data, uint16_t len) {
	if (len < sizeof(struct keeb_text_slot)) {
		return -KEEB_ERR_BAD_LEN;
	}

	struct keeb_text_slot slot;

	memcpy(&slot, data, sizeof(slot));

	if (slot.len != len - sizeof(slot)) {
		return -KEEB_ERR_BAD_LEN;
	}

	int err = keeb_ui_set_text(slot.slot, (const char *)(data + sizeof(slot)), slot.len);

	if (err) {
		return err;
	}

	dirty = true;

	return 0;
}

int keeb_display_set_value(const uint8_t *data, uint16_t len) {
	if (len < sizeof(struct keeb_value_slot)) {
		return -KEEB_ERR_BAD_LEN;
	}

	struct keeb_value_slot slot;

	memcpy(&slot, data, sizeof(slot));

	return keeb_ui_set_value(slot.slot, slot.value); /* live only: never dirty */
}

int keeb_display_preset(const uint8_t *data, uint16_t len) {
	uint8_t id = 0;

	if (len >= sizeof(struct keeb_preset_set)) {
		struct keeb_preset_set set;

		memcpy(&set, data, sizeof(set));
		id = set.preset;
	}

	int err = keeb_ui_apply_preset(id);

	if (err) {
		return err;
	}

	dirty = true;

	return 0;
}

int keeb_display_blank(void) {
	keeb_ui_blank_once();
	return 0;
}

/* --------------------------------------------------------------------------
 * Persistence
 * -------------------------------------------------------------------------- */

static int collect_saved(struct keeb_ui_saved_table *table, struct keeb_ui_saved_text *text) {
	uint8_t count = keeb_ui_widget_count();

	table->count = count;
	table->preset = keeb_ui_preset_id();
	memset(table->rsvd, 0, sizeof(table->rsvd));
	memcpy(table->widgets, keeb_ui_widgets(), sizeof(table->widgets));

	for (uint8_t slot = 0; slot < KBEEB_UI_TEXT_SLOTS; slot++) {
		if (keeb_ui_get_text(slot, text->text[slot], KBEEB_UI_TEXT_MAX + 1)) {
			text->text[slot][0] = '\0';
		}
	}

	return 0;
}

int keeb_display_save(void) {
#if !IS_ENABLED(CONFIG_SETTINGS)
	return -KEEB_ERR_NOT_SUPPORTED;
#else
	struct keeb_ui_saved_table table;
	struct keeb_ui_saved_text text;

	collect_saved(&table, &text);

	int err = settings_save_one(KEEB_UI_SETTINGS_TABLE, &table, sizeof(table));

	if (err) {
		LOG_ERR("saving panel layout failed (%d)", err);
		return -KEEB_ERR_STORAGE;
	}

	err = settings_save_one(KEEB_UI_SETTINGS_TEXT, &text, sizeof(text));

	if (err) {
		LOG_ERR("saving panel text failed (%d)", err);
		return -KEEB_ERR_STORAGE;
	}

	dirty = false;

	LOG_INF("panel saved to settings: %u widget(s)", table.count);

	return 0;
#endif
}

int keeb_display_discard(void) {
#if !IS_ENABLED(CONFIG_SETTINGS)
	return -KEEB_ERR_NOT_SUPPORTED;
#else
	/* Same order as zmk_keymap_discard_changes(): fall back to the built-in
	 * look first, then let anything that was saved land on top of it. */
	keeb_ui_apply_preset(0);

	int err = settings_load_subtree("keebui");

	if (err < 0) {
		LOG_ERR("reloading the saved panel failed (%d)", err);
		return -KEEB_ERR_STORAGE;
	}

	dirty = false;

	return 0;
#endif
}

int keeb_display_reset(void) {
#if !IS_ENABLED(CONFIG_SETTINGS)
	return -KEEB_ERR_NOT_SUPPORTED;
#else
	settings_delete(KEEB_UI_SETTINGS_TABLE);
	settings_delete(KEEB_UI_SETTINGS_TEXT);

	int err = keeb_ui_apply_preset(0);

	dirty = false;

	LOG_INF("saved panel cleared");

	return err ? -KEEB_ERR_STORAGE : 0;
#endif
}

#if IS_ENABLED(CONFIG_SETTINGS)

static int keeb_ui_settings_set(const char *name, size_t len, settings_read_cb read_cb,
				void *cb_arg) {
	const char *next;

	if (settings_name_steq(name, "table", &next) && !next) {
		if (len > sizeof(pending_table)) {
			return -EINVAL;
		}

		int err = read_cb(cb_arg, &pending_table, sizeof(pending_table));

		if (err <= 0) {
			LOG_ERR("panel layout read from settings failed (%d)", err);
			return err;
		}

		pending_has_table = true;
		return 0;
	}

	if (settings_name_steq(name, "text", &next) && !next) {
		if (len > sizeof(pending_text)) {
			return -EINVAL;
		}

		int err = read_cb(cb_arg, &pending_text, sizeof(pending_text));

		if (err <= 0) {
			LOG_ERR("panel text read from settings failed (%d)", err);
			return err;
		}

		pending_has_text = true;
		return 0;
	}

	return -ENOENT;
}

static int keeb_ui_settings_commit(void) {
	if (pending_has_table) {
		struct keeb_ui_saved_table *t = &pending_table;

		if (t->count <= KBEEB_UI_WIDGET_MAX) {
			/* keeb_ui_set_widgets requests the redraw itself. */
			if (keeb_ui_set_widgets(t->widgets, t->count)) {
				LOG_WRN("saved panel layout is not drawable here; keeping the "
					"built-in one");
			}
		} else {
			LOG_WRN("saved panel layout has %u widgets, this build holds %u", t->count,
				KBEEB_UI_WIDGET_MAX);
		}

		pending_has_table = false;
	}

	if (pending_has_text) {
		for (uint8_t slot = 0; slot < KBEEB_UI_TEXT_SLOTS; slot++) {
			keeb_ui_set_text(slot, pending_text.text[slot],
					 (uint8_t)strlen(pending_text.text[slot]));
		}

		pending_has_text = false;
	}

	/* Settings load happens after a preset was applied at boot, so whatever
	 * landed here *is* the saved state. */
	dirty = false;

	keeb_ui_request_draw();

	return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(keeb_ui_store, "keebui", NULL, keeb_ui_settings_set,
			       keeb_ui_settings_commit, NULL);

#endif /* CONFIG_SETTINGS */

#else /* !CONFIG_KBEEB_UI: the engine answers, but there is no panel to change */

uint32_t keeb_display_capabilities(void) { return 0; }

void keeb_display_info(struct keeb_display_info *info) { memset(info, 0, sizeof(*info)); }

int keeb_display_names(struct keeb_tlv_msg *msg) {
	ARG_UNUSED(msg);
	return -KEEB_ERR_NOT_SUPPORTED;
}

int keeb_display_dump(struct keeb_tlv_msg *msg) {
	ARG_UNUSED(msg);
	return -KEEB_ERR_NOT_SUPPORTED;
}

int keeb_display_set_table(const uint8_t *data, uint16_t len, uint16_t *applied) {
	ARG_UNUSED(data);
	ARG_UNUSED(len);
	ARG_UNUSED(applied);
	return -KEEB_ERR_NOT_SUPPORTED;
}

int keeb_display_set_widget(const uint8_t *data, uint16_t len) {
	ARG_UNUSED(data);
	ARG_UNUSED(len);
	return -KEEB_ERR_NOT_SUPPORTED;
}

int keeb_display_set_text(const uint8_t *data, uint16_t len) {
	ARG_UNUSED(data);
	ARG_UNUSED(len);
	return -KEEB_ERR_NOT_SUPPORTED;
}

int keeb_display_set_value(const uint8_t *data, uint16_t len) {
	ARG_UNUSED(data);
	ARG_UNUSED(len);
	return -KEEB_ERR_NOT_SUPPORTED;
}

int keeb_display_preset(const uint8_t *data, uint16_t len) {
	ARG_UNUSED(data);
	ARG_UNUSED(len);
	return -KEEB_ERR_NOT_SUPPORTED;
}

int keeb_display_save(void) { return -KEEB_ERR_NOT_SUPPORTED; }
int keeb_display_discard(void) { return -KEEB_ERR_NOT_SUPPORTED; }
int keeb_display_reset(void) { return -KEEB_ERR_NOT_SUPPORTED; }
int keeb_display_blank(void) { return -KEEB_ERR_NOT_SUPPORTED; }
bool keeb_display_dirty(void) { return false; }

#endif /* CONFIG_KBEEB_UI */
