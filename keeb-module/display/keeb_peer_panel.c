/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * See keeb_peer_panel.h. The central's copy of the other half's panel: the
 * protocol side (validate then store), the persistence side ("keebpeer"), and
 * the relay that makes the peripheral draw it.
 */

#include <zephyr/devicetree.h>
#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include <stdio.h>
#include <string.h>

#if IS_ENABLED(CONFIG_SETTINGS)
#include <zephyr/settings/settings.h>
#endif

#include "../proto/keeb_tlv.h"
#include "keeb_peer_panel.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#if IS_ENABLED(CONFIG_KEEB_UI) && IS_ENABLED(CONFIG_KEEB_UI_PEER_PANEL) &&                     \
	IS_ENABLED(CONFIG_ZMK_SPLIT) && IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)

#define KEEB_PEER_AVAILABLE 1

#include "../boards/shields/keeb/ui/keeb_ui.h"
#include "../boards/shields/keeb/ui/panel_stream.h"
#include "../boards/shields/keeb/ui/widget_model.h"

#include <zmk/behavior.h>
#include <zmk/split/bluetooth/service.h>

#include "../boards/shields/keeb/ui/layer_sync.h"

#define KEEB_PEER_SETTINGS_SUBTREE "keebpeer"
#define KEEB_PEER_SETTINGS_TABLE "keebpeer/table"
#define KEEB_PEER_SETTINGS_TEXT "keebpeer/text"

/* The behaviour the relay rides on; its node lives in the shared keeb.dtsi, so
 * it exists on the peripheral too, which is the half that runs it. */
#define KEEB_PANEL_NODE DT_NODELABEL(panel_relay)
#define KEEB_PANEL_DEV DEVICE_DT_NAME(KEEB_PANEL_NODE)

BUILD_ASSERT(DT_NODE_HAS_STATUS(KEEB_PANEL_NODE, okay),
	     "CONFIG_KEEB_UI_PEER_PANEL needs the panel_relay behaviour node from keeb.dtsi");
BUILD_ASSERT(sizeof(KEEB_PANEL_DEV) <= ZMK_SPLIT_RUN_BEHAVIOR_DEV_LEN,
	     "panel node name is too long for the split transport payload");

struct keeb_peer_saved_table {
	uint8_t count;
	uint8_t preset;
	uint8_t rsvd[2];
	struct keeb_widget widgets[KEEB_UI_WIDGET_MAX];
};

struct keeb_peer_saved_text {
	char text[KEEB_UI_TEXT_SLOTS][KEEB_UI_TEXT_MAX + 1];
};

static struct keeb_widget widgets[KEEB_UI_WIDGET_MAX];
static uint8_t widget_count;
static uint8_t preset_id;
static char texts[KEEB_UI_TEXT_SLOTS][KEEB_UI_TEXT_MAX + 1];
static bool dirty;

#if IS_ENABLED(CONFIG_SETTINGS)
static struct keeb_peer_saved_table pending_table;
static struct keeb_peer_saved_text pending_text;
static bool pending_has_table;
static bool pending_has_text;
#endif

bool keeb_peer_panel_available(void) { return true; }

/* --------------------------------------------------------------------------
 * The table this half keeps
 * -------------------------------------------------------------------------- */

/** Put the peer's compiled-in preset back. Returns 0 or -KEEB_ERR_*. */
static int seed_preset(uint8_t id) {
	const struct keeb_ui_preset *preset = keeb_ui_peer_preset(id);

	if (!preset || preset->count > KEEB_UI_WIDGET_MAX) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	widget_count = preset->count;
	preset_id = id;
	memcpy(widgets, preset->widgets, preset->count * sizeof(*widgets));

	for (uint8_t slot = 0; slot < KEEB_UI_TEXT_SLOTS; slot++) {
		snprintf(texts[slot], sizeof(texts[slot]), "%s",
			 preset->texts[slot] ? preset->texts[slot] : "");
	}

	dirty = false;

	return 0;
}

static int seed_default(void) {
	if (!seed_preset((uint8_t)CONFIG_KEEB_UI_PEER_PRESET)) {
		return 0;
	}

	return seed_preset(0);
}

bool keeb_peer_panel_dirty(void) { return dirty; }

/* --------------------------------------------------------------------------
 * The relay
 * -------------------------------------------------------------------------- */

static void relay_send(uint32_t first, uint32_t second) {
	struct zmk_behavior_binding binding = {
		.behavior_dev = KEEB_PANEL_DEV,
		.param1 = first,
		.param2 = second,
	};
	struct zmk_behavior_binding_event event = {
		.layer = 0,
		.position = 0, /* not a key press */
		.timestamp = k_uptime_get(),
		.source = ZMK_POSITION_STATE_CHANGE_SOURCE_LOCAL,
	};

	int err = zmk_behavior_invoke_binding(&binding, event, true);

	if (err < 0) {
		/* Usually the other half is not connected; the connect edge re-pushes. */
		LOG_WRN("peer panel relay failed (%d)", err);
	}
}

static void push_stream(const uint8_t *payload, uint16_t len) {
	if (len == 0 || len > KEEB_PANEL_STREAM_MAX) {
		return;
	}

	/* Nothing to relay to: the connect edge pushes, so staying quiet here keeps
	 * a disconnected half from logging one warning per chunk. */
	if (!keeb_layer_sync_peer_connected()) {
		return;
	}

	relay_send(KEEB_PANEL_STREAM_HDR(len), keeb_panel_crc32(payload, len));

	for (uint16_t at = 0; at < len; at += 8) {
		uint32_t first = 0;
		uint32_t second = 0;
		uint16_t left = len - at;

		memcpy(&first, payload + at, left < 4 ? left : 4);

		if (left > 4) {
			memcpy(&second, payload + at + 4, left - 4 < 4 ? left - 4 : 4);
		}

		relay_send(first, second);
	}
}

static void push_table(void) {
	uint8_t buf[KEEB_PANEL_STREAM_MAX];
	uint16_t at = 0;

	buf[at++] = KEEB_PANEL_STREAM_TABLE;
	buf[at++] = widget_count;

	memcpy(buf + at, widgets, widget_count * sizeof(*widgets));
	at += widget_count * sizeof(*widgets);

	for (uint8_t slot = 0; slot < KEEB_UI_TEXT_SLOTS; slot++) {
		uint8_t len = (uint8_t)strlen(texts[slot]);

		if ((uint16_t)(at + 1 + len) > sizeof(buf)) {
			return;
		}

		buf[at++] = len;
		memcpy(buf + at, texts[slot], len);
		at += len;
	}

	push_stream(buf, at);
}

void keeb_peer_panel_push(void) { push_table(); }

/* --------------------------------------------------------------------------
 * Read side
 * -------------------------------------------------------------------------- */

void keeb_peer_panel_info(struct keeb_display_info *info) {
	memset(info, 0, sizeof(*info));

	/* The central can write it, so it is editable - it just travels one
	 * relay further than the local panel. */
	info->editable = 1;
	info->preset_count = keeb_ui_peer_preset_count();
	info->widget_max = KEEB_UI_WIDGET_MAX;
	info->text_slots = KEEB_UI_TEXT_SLOTS;
	info->text_max = KEEB_UI_TEXT_MAX;
	info->value_slots = 0; /* live numbers are not relayed */
	info->kind_max = KEEB_WID_COUNT;
	info->source_max = KEEB_SRC_RSSI; /* WPM / profile pips / signal too */
	info->logical_w = KEEB_UI_PEER_W;
	info->logical_h = KEEB_UI_PEER_H;
	info->panel_w = KEEB_PANEL_W;
	info->panel_h = KEEB_PANEL_H;
	info->rotation = KEEB_UI_PEER_ROTATION_DEG;
	info->widget_size = sizeof(struct keeb_widget);
	info->flags = KEEB_UI_PEER_ART_LINKED ? KEEB_DISPLAY_INFO_F_ART : 0;
	info->layers = KEEB_LAYER_COUNT;
}

int keeb_peer_panel_dump(struct keeb_tlv_msg *msg) {
	struct keeb_display_hdr *hdr = keeb_tlv_rec_add(
			msg, KEEB_T_PEER_DISPLAY,
			(uint16_t)(sizeof(*hdr) + widget_count * sizeof(struct keeb_widget)));

	if (!hdr) {
		return -KEEB_ERR_TOO_BIG;
	}

	hdr->count = widget_count;
	hdr->preset = preset_id;
	hdr->flags = dirty ? KEEB_DISPLAY_F_DIRTY : 0;
	hdr->rsvd = 1; /* this is the peer's table, not the connected panel's */

	memcpy(((uint8_t *)hdr) + sizeof(*hdr), widgets,
	       widget_count * sizeof(struct keeb_widget));

	for (uint8_t slot = 0; slot < KEEB_UI_TEXT_SLOTS; slot++) {
		uint8_t len = (uint8_t)strlen(texts[slot]);
		struct keeb_text_slot *rec =
				keeb_tlv_rec_add(msg, KEEB_T_PEER_TEXT_SET,
						 (uint16_t)(sizeof(*rec) + len));

		if (!rec) {
			return -KEEB_ERR_TOO_BIG;
		}

		rec->slot = slot;
		rec->len = len;
		memcpy(((uint8_t *)rec) + sizeof(*rec), texts[slot], len);
	}

	return 0;
}

/* --------------------------------------------------------------------------
 * Write side
 * -------------------------------------------------------------------------- */

int keeb_peer_panel_set_table(const uint8_t *data, uint16_t len, uint16_t *applied) {
	if (len < sizeof(struct keeb_display_hdr)) {
		return -KEEB_ERR_BAD_LEN;
	}

	struct keeb_display_hdr hdr;

	memcpy(&hdr, data, sizeof(hdr));

	if (hdr.count > KEEB_UI_WIDGET_MAX) {
		return -KEEB_ERR_NO_SPACE;
	}

	if (len != sizeof(hdr) + hdr.count * sizeof(struct keeb_widget)) {
		return -KEEB_ERR_BAD_LEN;
	}

	const struct keeb_widget *next = (const struct keeb_widget *)(data + sizeof(hdr));

	/* Validate against the space the *other* half draws in, before replacing
	 * any of what it is showing: the peripheral refuses a bad table whole, but
	 * it has no way to tell this half about it. */
	for (uint8_t i = 0; i < hdr.count; i++) {
		int err = keeb_ui_peer_validate_widget(&next[i]);

		if (err) {
			return err;
		}
	}

	memcpy(widgets, next, hdr.count * sizeof(*widgets));
	for (uint8_t i = hdr.count; i < KEEB_UI_WIDGET_MAX; i++) {
		widgets[i].kind = KEEB_WID_NONE;
	}
	widget_count = hdr.count;
	preset_id = KEEB_PRESET_CUSTOM;
	dirty = true;

	*applied = hdr.count;
	push_table();

	LOG_INF("peer panel: %u widget(s) applied", hdr.count);

	return 0;
}

int keeb_peer_panel_set_text(const uint8_t *data, uint16_t len) {
	if (len < sizeof(struct keeb_text_slot)) {
		return -KEEB_ERR_BAD_LEN;
	}

	struct keeb_text_slot slot;

	memcpy(&slot, data, sizeof(slot));

	if (slot.len != len - sizeof(slot) || slot.slot >= KEEB_UI_TEXT_SLOTS ||
	    slot.len > KEEB_UI_TEXT_MAX) {
		return -KEEB_ERR_BAD_LEN;
	}

	memcpy(texts[slot.slot], data + sizeof(slot), slot.len);
	texts[slot.slot][slot.len] = '\0';
	dirty = true;

	push_table();

	return 0;
}

/* --------------------------------------------------------------------------
 * Persistence: its own subtree, so a corrupt peer blob costs the peer panel
 * and nothing else.
 * -------------------------------------------------------------------------- */

static void collect_saved(struct keeb_peer_saved_table *table, struct keeb_peer_saved_text *text) {
	table->count = widget_count;
	table->preset = preset_id;
	memset(table->rsvd, 0, sizeof(table->rsvd));
	memcpy(table->widgets, widgets, sizeof(table->widgets));

	for (uint8_t slot = 0; slot < KEEB_UI_TEXT_SLOTS; slot++) {
		snprintf(text->text[slot], sizeof(text->text[slot]), "%s", texts[slot]);
	}
}

int keeb_peer_panel_save(void) {
#if !IS_ENABLED(CONFIG_SETTINGS)
	return -KEEB_ERR_NOT_SUPPORTED;
#else
	struct keeb_peer_saved_table table;
	struct keeb_peer_saved_text text;

	collect_saved(&table, &text);

	int err = settings_save_one(KEEB_PEER_SETTINGS_TABLE, &table, sizeof(table));

	if (err) {
		LOG_ERR("saving the peer panel failed (%d)", err);
		return -KEEB_ERR_STORAGE;
	}

	err = settings_save_one(KEEB_PEER_SETTINGS_TEXT, &text, sizeof(text));

	if (err) {
		LOG_ERR("saving the peer panel text failed (%d)", err);
		return -KEEB_ERR_STORAGE;
	}

	dirty = false;
	LOG_INF("peer panel saved to settings: %u widget(s)", table.count);

	return 0;
#endif
}

int keeb_peer_panel_discard(void) {
#if !IS_ENABLED(CONFIG_SETTINGS)
	return -KEEB_ERR_NOT_SUPPORTED;
#else
	seed_default();

	int err = settings_load_subtree(KEEB_PEER_SETTINGS_SUBTREE);

	if (err < 0) {
		LOG_ERR("reloading the saved peer panel failed (%d)", err);
		return -KEEB_ERR_STORAGE;
	}

	dirty = false;
	push_table();

	return 0;
#endif
}

int keeb_peer_panel_reset(void) {
#if !IS_ENABLED(CONFIG_SETTINGS)
	return -KEEB_ERR_NOT_SUPPORTED;
#else
	settings_delete(KEEB_PEER_SETTINGS_TABLE);
	settings_delete(KEEB_PEER_SETTINGS_TEXT);

	seed_default();
	push_table();

	LOG_INF("saved peer panel cleared");

	return 0;
#endif
}

int keeb_peer_panel_blank(void) {
	uint8_t kind = KEEB_PANEL_STREAM_BLANK;

	push_stream(&kind, 1);

	return 0;
}

#if IS_ENABLED(CONFIG_SETTINGS)

static int keeb_peer_settings_set(const char *name, size_t len, settings_read_cb read_cb,
				  void *cb_arg) {
	const char *next;

	if (settings_name_steq(name, "table", &next) && !next) {
		if (len > sizeof(pending_table)) {
			return -EINVAL;
		}

		memset(&pending_table, 0, sizeof(pending_table));

		int err = read_cb(cb_arg, &pending_table, sizeof(pending_table));

		if (err <= 0) {
			LOG_ERR("peer panel read from settings failed (%d)", err);
			return err;
		}

		pending_has_table = true;
		return 0;
	}

	if (settings_name_steq(name, "text", &next) && !next) {
		if (len > sizeof(pending_text)) {
			return -EINVAL;
		}

		memset(&pending_text, 0, sizeof(pending_text));

		int err = read_cb(cb_arg, &pending_text, sizeof(pending_text));

		if (err <= 0) {
			LOG_ERR("peer panel text read from settings failed (%d)", err);
			return err;
		}

		pending_has_text = true;
		return 0;
	}

	return -ENOENT;
}

static int keeb_peer_settings_commit(void) {
	if (pending_has_table) {
		if (pending_table.count > KEEB_UI_WIDGET_MAX) {
			LOG_WRN("saved peer panel carries %u widgets, ignored", pending_table.count);
		} else {
			bool ok = true;

			for (uint8_t i = 0; i < pending_table.count; i++) {
				if (keeb_ui_peer_validate_widget(&pending_table.widgets[i])) {
					ok = false;
					break;
				}
			}

			if (ok) {
				memcpy(widgets, pending_table.widgets, sizeof(widgets));
				widget_count = pending_table.count;
				preset_id = pending_table.preset;
				dirty = false;
				LOG_INF("peer panel loaded from settings: %u widget(s)",
					widget_count);
			} else {
				LOG_WRN("saved peer panel has a widget this build cannot draw, ignored");
			}
		}
	}

	if (pending_has_text) {
		memcpy(texts, pending_text.text, sizeof(texts));

		for (uint8_t slot = 0; slot < KEEB_UI_TEXT_SLOTS; slot++) {
			texts[slot][KEEB_UI_TEXT_MAX] = '\0';
		}
	}

	pending_has_table = false;
	pending_has_text = false;

	return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(keeb_peer_store, KEEB_PEER_SETTINGS_SUBTREE, NULL,
			       keeb_peer_settings_set, keeb_peer_settings_commit, NULL);

#endif /* CONFIG_SETTINGS */

static int keeb_peer_panel_init(void) {
	seed_default();

	return 0;
}

/* Same priority as the widget model's init: this half's own table and the peer's
 * are independent state, and both seed from compiled-in presets. */
SYS_INIT(keeb_peer_panel_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);

#else /* !KEEB_PEER_AVAILABLE */

bool keeb_peer_panel_available(void) { return false; }

void keeb_peer_panel_info(struct keeb_display_info *info) { memset(info, 0, sizeof(*info)); }

int keeb_peer_panel_dump(struct keeb_tlv_msg *msg) {
	ARG_UNUSED(msg);
	return -KEEB_ERR_NOT_SUPPORTED;
}

int keeb_peer_panel_set_table(const uint8_t *data, uint16_t len, uint16_t *applied) {
	ARG_UNUSED(data);
	ARG_UNUSED(len);
	ARG_UNUSED(applied);
	return -KEEB_ERR_NOT_SUPPORTED;
}

int keeb_peer_panel_set_text(const uint8_t *data, uint16_t len) {
	ARG_UNUSED(data);
	ARG_UNUSED(len);
	return -KEEB_ERR_NOT_SUPPORTED;
}

int keeb_peer_panel_save(void) { return -KEEB_ERR_NOT_SUPPORTED; }
int keeb_peer_panel_discard(void) { return -KEEB_ERR_NOT_SUPPORTED; }
int keeb_peer_panel_reset(void) { return -KEEB_ERR_NOT_SUPPORTED; }
int keeb_peer_panel_blank(void) { return -KEEB_ERR_NOT_SUPPORTED; }
bool keeb_peer_panel_dirty(void) { return false; }
void keeb_peer_panel_push(void) {}

#endif /* KEEB_PEER_AVAILABLE */
