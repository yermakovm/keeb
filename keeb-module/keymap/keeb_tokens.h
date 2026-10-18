/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Token table: the behaviors a TLV host may bind. The table is generated from
 * devicetree (keeb,engine:tokens), so adding a behavior to the configurator is
 * a one-line devicetree change, and token ids cannot drift from the list the
 * hash is computed over.
 */

#pragma once

#include <stdbool.h>
#include <stdint.h>

/** A token: the index into keeb,engine:tokens plus the ZMK behavior it names. */
struct keeb_token {
	uint16_t id; /* token id == devicetree order */
	const char *name; /* ZMK device name, e.g. "key_press" */
};

/** Number of tokens (devicetree order). Reported as keeb_info.token_count. */
uint16_t keeb_token_count(void);

/** CRC-32 over the table (ids and names, in order). The configurator compares
 * this against its own copy before writing anything, which is what stops a
 * host from binding a behavior it believes is at a different index - ZMK
 * resolves bindings by device-name string, so a silent mismatch would be a
 * wrong layout, not a rejected write.
 */
uint32_t keeb_token_hash(void);

/** Look up a token id. Returns NULL for an id the table does not have. */
const struct keeb_token *keeb_token_get(uint16_t id);

/** Look up a behavior by ZMK device name. Returns NULL when the token table
 * does not cover it, which happens for bindings a keymap file defines but the
 * configurator cannot express (macros, for instance).
 */
const struct keeb_token *keeb_token_by_name(const char *name);

/** True when the behavior behind a token is actually usable in this build:
 * a behavior node stays in devicetree even when its driver was not compiled
 * (keeb,engine:tokens references keep /omit-if-no-ref/ nodes alive), so the
 * device lookup is the only honest answer. Checked lazily, because the
 * behavior devices are ready only after their own init has run.
 */
bool keeb_token_ready(uint16_t id);
