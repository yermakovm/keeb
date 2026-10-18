/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Live keymap mutation over ZMK's own dynamic keymap core. See keeb_keymap.h
 * for why every core call lives in this file.
 *
 * Two ZMK facts drive the design:
 *
 *   - A binding is { behavior_dev (device-name string), param1, param2 } and
 *     ZMK resolves it by name (zmk_behavior_get_binding). Only behaviors that
 *     are in the image can be bound, which is why the TLV protocol references
 *     them by token from the devicetree table instead of by host-supplied
 *     names.
 *   - Indices passed to the core are *stock* positions: the core maps them
 *     through zmk_physical_layouts_get_selected_to_stock_position_map()
 *     (zmk/app/src/keymap.c), so a configurator can work in the 12-column grid
 *     the keymap file is written in and stay independent of the matrix
 *     transform.
 */

#include <zephyr/devicetree.h>
#include <zephyr/device.h>
#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <string.h>

#include <drivers/behavior.h>
#include <zmk/behavior.h>
#include <zmk/event_manager.h>
#include <zmk/events/position_state_changed.h>
#include <zmk/keymap.h>
#include <zmk/matrix.h>

#include "../engine/keeb_engine.h"
#include "../proto/keeb_tlv.h"
#include "keeb_keymap.h"
#include "keeb_tokens.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#define ENGINE_NODE DT_NODELABEL(keeb_engine)

#if !DT_NODE_EXISTS(ENGINE_NODE)
#error "No keeb,engine node: the TLV engine needs its token list and reserved positions"
#endif

/* Reserved positions, straight from devicetree. */
#define RESERVED_ENTRY(node, prop, idx) DT_PROP_BY_IDX(node, prop, idx),

static const uint16_t reserved_positions[] = {
	DT_FOREACH_PROP_ELEM(ENGINE_NODE, reserved_positions, RESERVED_ENTRY)
};

#define KEEB_REVERT_HOLD_MS DT_PROP(ENGINE_NODE, revert_hold_ms)

uint8_t keeb_keymap_reserved_count(void)
{
	return (uint8_t)ARRAY_SIZE(reserved_positions);
}

uint16_t keeb_keymap_reserved_pos(uint8_t idx)
{
	return idx < ARRAY_SIZE(reserved_positions) ? reserved_positions[idx] : 0xffffu;
}

bool keeb_keymap_reserved(uint16_t pos)
{
	for (size_t i = 0; i < ARRAY_SIZE(reserved_positions); i++) {
		if (reserved_positions[i] == pos) {
			return true;
		}
	}

	return false;
}

void keeb_keymap_info(struct keeb_info *info)
{
	memset(info, 0, sizeof(*info));

	info->proto = KEEB_TLV_VERSION;
	info->fw_version = CONFIG_KBEEB_ENGINE_FW_VERSION;
	info->layer_count = ZMK_KEYMAP_LAYERS_LEN;
	info->key_count = ZMK_KEYMAP_LEN;
	info->name_max = CONFIG_ZMK_KEYMAP_LAYER_NAME_MAX_LEN;
	info->token_count = keeb_token_count();
	info->token_hash = keeb_token_hash();

	info->flags = KEEB_INFO_F_RESERVED_FROZEN;
	if (IS_ENABLED(CONFIG_ZMK_KEYMAP_SETTINGS_STORAGE)) {
		info->flags |= KEEB_INFO_F_PERSISTENT;
	}
	if (IS_ENABLED(CONFIG_ZMK_KEYMAP_LAYER_REORDERING)) {
		info->flags |= KEEB_INFO_F_REORDERING;
	}
}

int keeb_keymap_dump(uint8_t layer_id, struct keeb_tlv_msg *msg)
{
	if (layer_id >= ZMK_KEYMAP_LAYERS_LEN) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	uint16_t count = ZMK_KEYMAP_LEN;
	size_t payload = sizeof(struct keeb_cells_hdr) + (size_t)count * sizeof(struct keeb_cell);

	uint8_t *p = keeb_tlv_rec_add(msg, KEEB_T_CELLS, (uint16_t)payload);

	if (!p) {
		return -KEEB_ERR_TOO_BIG;
	}

	struct keeb_cells_hdr *hdr = (struct keeb_cells_hdr *)p;
	struct keeb_cell *cells = (struct keeb_cell *)(p + sizeof(*hdr));

	hdr->layer = layer_id;
	hdr->flags = 0;
	hdr->count = count;

	for (uint16_t pos = 0; pos < count; pos++) {
		const struct zmk_behavior_binding *binding =
				zmk_keymap_get_layer_binding_at_idx(layer_id, pos);
		struct keeb_cell *cell = &cells[pos];

		memset(cell, 0, sizeof(*cell));
		cell->layer = layer_id;
		cell->pos = pos;

		if (keeb_keymap_reserved(pos)) {
			cell->flags |= KEEB_CELL_F_RESERVED;
		}

		if (!binding || !binding->behavior_dev) {
			/* The physical layout does not map this grid slot. */
			cell->token = KEEB_TOKEN_NONE;
			continue;
		}

		const struct keeb_token *token = keeb_token_by_name(binding->behavior_dev);

		cell->token = token ? token->id : KEEB_TOKEN_UNKNOWN;
		cell->param1 = binding->param1;
		cell->param2 = binding->param2;
	}

	return 0;
}

/* Build a ZMK binding from a token plus its params. token->name is the same
 * DEVICE_DT_NAME expression ZMK uses for its own table, so the string resolves.
 */
static struct zmk_behavior_binding binding_from_token(const struct keeb_token *token,
							 uint32_t param1, uint32_t param2)
{
	return (struct zmk_behavior_binding){
			.behavior_dev = token->name,
			.param1 = param1,
			.param2 = param2,
	};
}

static int entry_binding(const struct keeb_cells_set_hdr *hdr, const struct keeb_cell_set *entry,
			 struct zmk_behavior_binding *binding)
{
	if (entry->pos >= ZMK_KEYMAP_LEN) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	if (keeb_keymap_reserved(entry->pos)) {
		return -KEEB_ERR_RESERVED_POSITION;
	}

	/* An unmapped grid slot cannot be written: the core maps stock to
	 * storage positions and refuses the ones its layout does not have.
	 */
	if (!zmk_keymap_get_layer_binding_at_idx(hdr->layer, entry->pos)) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	const struct keeb_token *token = keeb_token_get(entry->token);

	if (!token) {
		return -KEEB_ERR_UNKNOWN_TOKEN;
	}

	if (entry->token == KEEB_TOKEN_NONE) {
		/* A dump may report KEEB_TOKEN_NONE; a write must name a real
		 * token, so unassigning a key means binding the transparent
		 * token from the token listing.
		 */
		return -KEEB_ERR_UNKNOWN_TOKEN;
	}

	*binding = binding_from_token(token, entry->param1, entry->param2);

	/* ZMK's own validation against the behavior's param metadata. Studio
	 * uses the same call (zmk/app/src/studio/keymap_subsystem.c), so this
	 * is the firmware's real rule for a legal binding, not a guess at it.
	 */
	int err = zmk_behavior_validate_binding(binding);

	if (err) {
		LOG_WRN("token %u rejected by behavior validation: %d", entry->token, err);
		return -KEEB_ERR_BEHAVIOR;
	}

	return 0;
}

int keeb_keymap_set_cells(const uint8_t *data, uint16_t len, uint16_t *applied)
{
	if (!IS_ENABLED(CONFIG_ZMK_KEYMAP_SETTINGS_STORAGE)) {
		LOG_ERR("CONFIG_ZMK_KEYMAP_SETTINGS_STORAGE is off, keymap is immutable");
		return -KEEB_ERR_NOT_SUPPORTED;
	}

	if (len < sizeof(struct keeb_cells_set_hdr)) {
		return -KEEB_ERR_BAD_LEN;
	}

	const struct keeb_cells_set_hdr *hdr = (const struct keeb_cells_set_hdr *)data;

	if (hdr->layer >= ZMK_KEYMAP_LAYERS_LEN) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	size_t expected = sizeof(*hdr) + (size_t)hdr->count * sizeof(struct keeb_cell_set);

	if (len != expected || hdr->count > ZMK_KEYMAP_LEN) {
		return -KEEB_ERR_BAD_LEN;
	}

	const uint8_t *p = data + sizeof(*hdr);

	/* Validate the whole record first, then apply. Two passes over a
	 * buffer that is already in RAM is cheaper than a rollback journal,
	 * and it removes the worst failure mode of a config channel: half of
	 * a layout landing because entry 40 of 60 was invalid.
	 */
	for (uint16_t i = 0; i < hdr->count; i++) {
		const struct keeb_cell_set *entry =
				(const struct keeb_cell_set *)(p + i * sizeof(*entry));
		struct zmk_behavior_binding binding;
		int err = entry_binding(hdr, entry, &binding);

		if (err) {
			LOG_WRN("layer %u pos %u: %d", hdr->layer, entry->pos, -err);
			return err;
		}
	}

	for (uint16_t i = 0; i < hdr->count; i++) {
		const struct keeb_cell_set *entry =
				(const struct keeb_cell_set *)(p + i * sizeof(*entry));
		struct zmk_behavior_binding binding;

		if (entry_binding(hdr, entry, &binding)) {
			return -KEEB_ERR_BEHAVIOR; /* validated above */
		}

		int err = zmk_keymap_set_layer_binding_at_idx(hdr->layer, entry->pos, binding);

		if (err) {
			LOG_ERR("layer %u pos %u: set failed (%d)", hdr->layer, entry->pos, err);
			return -KEEB_ERR_BEHAVIOR;
		}
	}

	*applied = hdr->count;

	LOG_INF("layer %u: %u cells rebound", hdr->layer, hdr->count);

	return 0;
}

int keeb_keymap_save(void)
{
	if (!IS_ENABLED(CONFIG_ZMK_KEYMAP_SETTINGS_STORAGE)) {
		return -KEEB_ERR_NOT_SUPPORTED;
	}

	int err = zmk_keymap_save_changes();

	if (err) {
		LOG_ERR("saving keymap failed (%d)", err);
		return -KEEB_ERR_STORAGE;
	}

	LOG_INF("keymap saved to settings");
	keeb_engine_notify(KEEB_EV_SAVED, NULL, 0);

	return 0;
}

int keeb_keymap_discard(void)
{
	if (!IS_ENABLED(CONFIG_ZMK_KEYMAP_SETTINGS_STORAGE)) {
		return -KEEB_ERR_NOT_SUPPORTED;
	}

	int err = zmk_keymap_discard_changes();

	if (err) {
		LOG_ERR("discarding keymap failed (%d)", err);
		return -KEEB_ERR_STORAGE;
	}

	LOG_INF("keymap reset to the keymap file");
	keeb_engine_notify(KEEB_EV_DISCARDED, NULL, 0);

	return 0;
}

int keeb_keymap_reset(void)
{
	if (!IS_ENABLED(CONFIG_ZMK_KEYMAP_SETTINGS_STORAGE)) {
		return -KEEB_ERR_NOT_SUPPORTED;
	}

	int err = zmk_keymap_reset_settings();

	if (err) {
		LOG_ERR("resetting keymap settings failed (%d)", err);
		return -KEEB_ERR_STORAGE;
	}

	LOG_WRN("saved keymap settings deleted");
	keeb_engine_notify(KEEB_EV_DISCARDED, NULL, 0);

	return 0;
}

int keeb_keymap_layers(struct keeb_tlv_msg *msg)
{
	uint16_t count = ZMK_KEYMAP_LAYERS_LEN;
	size_t payload = sizeof(struct keeb_layers_hdr) + count;

	uint8_t *p = keeb_tlv_rec_add(msg, KEEB_T_LAYERS, (uint16_t)payload);

	if (!p) {
		return -KEEB_ERR_TOO_BIG;
	}

	struct keeb_layers_hdr *hdr = (struct keeb_layers_hdr *)p;
	uint8_t *order = p + sizeof(*hdr);

	hdr->count = count;
	hdr->state = zmk_keymap_layer_state();
	hdr->locked = zmk_keymap_layer_locks();
	hdr->rsvd = 0;
	hdr->name_max = CONFIG_ZMK_KEYMAP_LAYER_NAME_MAX_LEN;

	hdr->active = 0xffffu;
	for (uint8_t id = 0; id < count; id++) {
		if (hdr->state & (1u << id)) {
			hdr->active = id; /* highest set id wins */
		}
		order[id] = zmk_keymap_layer_index_to_id(id);
	}

	/* Names travel as the same record the host uses to set them, so a
	 * listing and a rename look identical to the configurator.
	 */
	for (uint8_t id = 0; id < count; id++) {
		const char *name = zmk_keymap_layer_name(id);

		if (!name) {
			continue;
		}

		uint16_t name_len = (uint16_t)strlen(name);
		uint8_t *rec = keeb_tlv_rec_add(msg, KEEB_T_LAYER_NAME_SET,
						(uint16_t)(sizeof(id) + name_len));

		if (!rec) {
			return -KEEB_ERR_TOO_BIG;
		}

		rec[0] = id;
		memcpy(rec + sizeof(id), name, name_len);
	}

	return 0;
}

int keeb_keymap_set_name(uint8_t layer_id, const char *name, uint16_t len)
{
	if (!IS_ENABLED(CONFIG_ZMK_KEYMAP_SETTINGS_STORAGE)) {
		return -KEEB_ERR_NOT_SUPPORTED;
	}

	if (layer_id >= ZMK_KEYMAP_LAYERS_LEN || !name) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	/* The core stores into a fixed buffer that must keep its NUL. */
	if (len >= CONFIG_ZMK_KEYMAP_LAYER_NAME_MAX_LEN) {
		return -KEEB_ERR_BAD_LEN;
	}

	int err = zmk_keymap_set_layer_name(layer_id, name, len);

	if (err) {
		LOG_ERR("layer %u rename failed (%d)", layer_id, err);
		return -KEEB_ERR_BEHAVIOR;
	}

	keeb_engine_notify(KEEB_EV_LAYER_CHANGED, &layer_id, sizeof(layer_id));

	return 0;
}

int keeb_keymap_move(uint8_t from, uint8_t to)
{
	if (!IS_ENABLED(CONFIG_ZMK_KEYMAP_LAYER_REORDERING)) {
		return -KEEB_ERR_NOT_SUPPORTED;
	}

	if (from >= ZMK_KEYMAP_LAYERS_LEN || to >= ZMK_KEYMAP_LAYERS_LEN) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	int err = zmk_keymap_move_layer(from, to);

	if (err) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	keeb_engine_notify(KEEB_EV_LAYER_CHANGED, NULL, 0);

	return 0;
}

int keeb_keymap_add(uint8_t *index)
{
	if (!IS_ENABLED(CONFIG_ZMK_KEYMAP_LAYER_REORDERING)) {
		return -KEEB_ERR_NOT_SUPPORTED;
	}

	int err = zmk_keymap_add_layer();

	if (err == -ENOSPC) {
		return -KEEB_ERR_NO_SPACE;
	}
	if (err < 0) {
		return -KEEB_ERR_BEHAVIOR;
	}

	*index = (uint8_t)err;

	LOG_INF("layer slot %u now in use", *index);
	keeb_engine_notify(KEEB_EV_LAYER_CHANGED, NULL, 0);

	return 0;
}

int keeb_keymap_remove(uint8_t index)
{
	if (!IS_ENABLED(CONFIG_ZMK_KEYMAP_LAYER_REORDERING)) {
		return -KEEB_ERR_NOT_SUPPORTED;
	}

	if (index >= ZMK_KEYMAP_LAYERS_LEN) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	if (zmk_keymap_remove_layer(index) < 0) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	keeb_engine_notify(KEEB_EV_LAYER_CHANGED, NULL, 0);

	return 0;
}

int keeb_keymap_restore(uint8_t id, uint8_t index)
{
	if (!IS_ENABLED(CONFIG_ZMK_KEYMAP_LAYER_REORDERING)) {
		return -KEEB_ERR_NOT_SUPPORTED;
	}

	if (index >= ZMK_KEYMAP_LAYERS_LEN) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	if (zmk_keymap_restore_layer(id, index) < 0) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	keeb_engine_notify(KEEB_EV_LAYER_CHANGED, NULL, 0);

	return 0;
}

int keeb_keymap_token_params(uint16_t token, struct keeb_tlv_msg *msg)
{
#if !IS_ENABLED(CONFIG_ZMK_BEHAVIOR_METADATA)
	ARG_UNUSED(token);
	ARG_UNUSED(msg);
	return -KEEB_ERR_NOT_SUPPORTED;
#else
	const struct keeb_token *tok = keeb_token_get(token);

	if (!tok) {
		return -KEEB_ERR_UNKNOWN_TOKEN;
	}

	const struct device *dev = zmk_behavior_get_binding(tok->name);

	if (!dev) {
		return -KEEB_ERR_BEHAVIOR;
	}

	struct behavior_parameter_metadata md;
	int err = behavior_get_parameter_metadata(dev, &md);

	if (err) {
		return -KEEB_ERR_BEHAVIOR;
	}

	int partial = 0;

	for (size_t s = 0; s < md.sets_len; s++) {
		const struct behavior_parameter_metadata_set *set = &md.sets[s];

		for (uint8_t param = 0; param < 2; param++) {
			const struct behavior_parameter_value_metadata *vals =
					(param == 0) ? set->param1_values : set->param2_values;
			size_t n = (param == 0) ? set->param1_values_len : set->param2_values_len;

			for (size_t v = 0; v < n; v++) {
				const char *display = vals[v].display_name ? vals[v].display_name
									   : "";
				uint16_t name_len = (uint16_t)strlen(display);
				uint8_t *p = keeb_tlv_rec_add(msg, KEEB_T_TOKEN_PARAMS,
							       (uint16_t)(sizeof(struct keeb_param_value) +
									name_len));

				if (!p) {
					/* Report the truncation while keeping
					 * what already fits, which is what a
					 * picker needs to render: a partial
					 * list beats no list, and the ACK says
					 * the answer was cut.
					 */
					return partial ? 0 : -KEEB_ERR_TOO_BIG;
				}

				struct keeb_param_value *rec = (struct keeb_param_value *)p;

				rec->token = token;
				rec->param = param;
				rec->type = (uint8_t)vals[v].type;
				rec->set = (uint8_t)s;
				rec->name_len = name_len;
				rec->a = (vals[v].type == BEHAVIOR_PARAMETER_VALUE_TYPE_RANGE) ?
						(uint32_t)vals[v].range.min :
						vals[v].value;
				rec->b = (vals[v].type == BEHAVIOR_PARAMETER_VALUE_TYPE_RANGE) ?
						(uint32_t)vals[v].range.max :
						0u;

				memcpy(p + sizeof(*rec), display, name_len);
			}
		}
	}

	return 0;
#endif /* CONFIG_ZMK_BEHAVIOR_METADATA */
}

/* --------------------------------------------------------------------------
 * Revert chord
 * --------------------------------------------------------------------------
 * Hold every reserved position for keeb,engine:revert-hold-ms and the saved
 * keymap is discarded. It is written against raw key positions rather than
 * bindings, so it survives any layout - including one the configurator wrote
 * that made those keys useless, or a saved keymap that is nonsense. Without
 * this, a BLE-only keyboard has no way back from a bad layout.
 */

static uint8_t held_mask;
static bool revert_armed;

static void revert_fire(struct k_work *work);

/* Held-key timer for the revert chord. The system work queue is where this
 * runs, which is also where ZMK does its own settings writes, so the discard
 * lands in the same context as a TLV-driven one.
 */
K_WORK_DELAYABLE_DEFINE(revert_work, revert_fire);

static void revert_fire(struct k_work *work)
{
	ARG_UNUSED(work);

	revert_armed = false;
	held_mask = 0;

	LOG_WRN("revert chord held %u ms: discarding saved keymap", KEEB_REVERT_HOLD_MS);

	int err = keeb_keymap_discard();

	if (err) {
		LOG_ERR("revert failed (%d)", -err);
	}
}

static uint8_t reserved_all_mask(void)
{
	uint8_t mask = 0;

	for (size_t i = 0; i < ARRAY_SIZE(reserved_positions); i++) {
		mask |= (uint8_t)BIT(i);
	}

	return mask;
}

static int position_listener(const zmk_event_t *eh)
{
	struct zmk_position_state_changed *ev = as_zmk_position_state_changed(eh);

	if (!ev) {
		return 0;
	}

	uint8_t next = held_mask;

	for (size_t i = 0; i < ARRAY_SIZE(reserved_positions); i++) {
		if (ev->position == reserved_positions[i]) {
			if (ev->state) {
				next |= (uint8_t)BIT(i);
			} else {
				next &= (uint8_t)~BIT(i);
			}
		}
	}

	held_mask = next;

	uint8_t all = reserved_all_mask();

	if (ARRAY_SIZE(reserved_positions) > 0 && (held_mask & all) == all) {
		if (!revert_armed) {
			revert_armed = true;
			k_work_reschedule(&revert_work, K_MSEC(KEEB_REVERT_HOLD_MS));
			LOG_INF("revert chord armed: hold %u more ms", KEEB_REVERT_HOLD_MS);
		}
		return 0;
	}

	if (revert_armed) {
		revert_armed = false;
		k_work_cancel_delayable(&revert_work);
	}

	return 0;
}

ZMK_LISTENER(keeb_keymap_revert, position_listener);
ZMK_SUBSCRIPTION(keeb_keymap_revert, zmk_position_state_changed);

int keeb_keymap_revert_init(void)
{
	if (ARRAY_SIZE(reserved_positions) == 0) {
		LOG_WRN("no reserved positions, revert chord unavailable");
		return 0;
	}

	LOG_INF("revert chord: hold %s for %u ms to restore the keymap file",
		"every reserved position", KEEB_REVERT_HOLD_MS);

	return 0;
}
