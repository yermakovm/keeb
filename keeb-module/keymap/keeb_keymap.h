/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Live keymap mutation: reading and writing the running keyboard's layout and
 * layers through ZMK's own dynamic-keymap core (zmk/app/src/keymap.c).
 *
 * This is deliberately the ONLY file in the module that calls ZMK's keymap
 * core. These APIs are the ones ZMK Studio also uses, so they move whenever
 * Studio moves; keeping every call behind one file means a ZMK rebase is
 * audited in one place instead of scattered over the engine.
 */

#pragma once

#include <stdbool.h>
#include <stdint.h>

#include <zmk/keymap.h>

#include "../proto/keeb_tlv.h"

/** Fill a keeb_info record with what this build can do. */
void keeb_keymap_info(struct keeb_info *info);

/** Append a KEEB_T_CELLS record with one layer's bindings (stock position
 * order). Returns 0, or a negative KEEB_ERR_* reason.
 */
int keeb_keymap_dump(uint8_t layer_id, struct keeb_tlv_msg *msg);

/** Apply one KEEB_T_CELLS_SET record. The whole record is validated before any
 * binding is written, so a half-accepted layout cannot happen even when entry
 * 40 of 60 references a behavior this image does not have.
 *
 * On success *applied* reports how many cells were written. Rejected writes are
 * a hard error for the whole message: the configurator must resend, rather than
 * learn to live with a layout it did not ask for.
 */
int keeb_keymap_set_cells(const uint8_t *data, uint16_t len, uint16_t *applied);

/** Persist the running layout to settings (ZMK's keymap subtree). */
int keeb_keymap_save(void);

/** Reload the layout from the keymap file and drop saved changes. Also what the
 * revert chord does.
 */
int keeb_keymap_discard(void);

/** Delete saved keymap settings, then fall back to the keymap file. */
int keeb_keymap_reset(void);

/** Append a KEEB_T_LAYERS record (slot count, order, active state) followed by
 * one KEEB_T_LAYER_NAME_SET record per layer id.
 */
int keeb_keymap_layers(struct keeb_tlv_msg *msg);

/** Rename a layer id. `len` excludes the NUL and must fit
 * CONFIG_ZMK_KEYMAP_LAYER_NAME_MAX_LEN.
 */
int keeb_keymap_set_name(uint8_t layer_id, const char *name, uint16_t len);

/** Move the layer at slot `from` to slot `to`. Needs
 * CONFIG_ZMK_KEYMAP_LAYER_REORDERING.
 */
int keeb_keymap_move(uint8_t from, uint8_t to);

/** Take the next unused layer slot. *index* receives it. Needs reordering. */
int keeb_keymap_add(uint8_t *index);

/** Remove the layer at slot `index`. Needs reordering. */
int keeb_keymap_remove(uint8_t index);

/** Restore layer id `id` into slot `index`. Needs reordering. */
int keeb_keymap_restore(uint8_t id, uint8_t index);

/** Append the param metadata of one token, taken from ZMK's behavior metadata
 * (CONFIG_ZMK_BEHAVIOR_METADATA). This is how the configurator learns what a
 * token's params mean without duplicating ZMK's keycode tables in JavaScript.
 */
int keeb_keymap_token_params(uint16_t token, struct keeb_tlv_msg *msg);

/** True when `pos` is a reserved position the engine refuses to rebind. */
bool keeb_keymap_reserved(uint16_t pos);

/** Number of reserved positions and their stock indices. */
uint8_t keeb_keymap_reserved_count(void);
uint16_t keeb_keymap_reserved_pos(uint8_t idx);

/** Install the revert-chord listener (hold every reserved position for
 * keeb,engine:revert-hold-ms to discard the saved keymap). Runs on raw key
 * positions, so no layout can disable it.
 */
int keeb_keymap_revert_init(void);
