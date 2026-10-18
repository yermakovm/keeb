/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Token table generated from devicetree. See keeb_tokens.h.
 */

#include <zephyr/devicetree.h>
#include <zephyr/device.h>
#include <zephyr/init.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <string.h>

#include <drivers/behavior.h>
#include <zmk/behavior.h>

#include "../proto/keeb_tlv.h"

#include "keeb_tokens.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#define ENGINE_NODE DT_NODELABEL(keeb_engine)

#if !DT_NODE_EXISTS(ENGINE_NODE)
#error "No keeb,engine node: keeb.dtsi defines the token table the TLV engine needs"
#endif

/* Token id = devicetree order, name = the same string ZMK stores in a binding
 * (zmk/app/src/keymap.c uses DEVICE_DT_NAME for its own table). Using the same
 * expression is what makes a token resolve: ZMK looks bindings up by device
 * name, and zmk_behavior_get_binding() compares that name.
 */
#define KEEB_TOKEN_ENTRY(node, prop, idx)                                                           \
	{ .id = idx, .name = DEVICE_DT_NAME(DT_PHANDLE_BY_IDX(node, prop, idx)) },

static const struct keeb_token token_table[] = {
	/* DT_FOREACH_PROP_ELEM concatenates the invocations with no separator;
	 * KEEB_TOKEN_ENTRY supplies the trailing comma itself.
	 */
	DT_FOREACH_PROP_ELEM(ENGINE_NODE, tokens, KEEB_TOKEN_ENTRY)
};

/* Hash input is ids and names in table order, so a host that knows the list can
 * reproduce it:  u16 id (LE) | name bytes | 0x00, per token.
 *
 * Computed once, at boot. Nothing here depends on the behavior devices being
 * ready (unlike keeb_token_ready()), so the hash is stable from the first
 * request.
 */
static uint32_t cached_hash;
static bool cached_hash_valid;

static uint32_t build_hash(void)
{
	uint32_t state = KEEB_CRC32_START;

	for (size_t i = 0; i < ARRAY_SIZE(token_table); i++) {
		uint8_t id_le[2] = { (uint8_t)(token_table[i].id & 0xffu),
				     (uint8_t)(token_table[i].id >> 8) };

		state = keeb_crc32_update(state, id_le, sizeof(id_le));
		state = keeb_crc32_update(state, (const uint8_t *)token_table[i].name,
					  (uint16_t)strlen(token_table[i].name));
		state = keeb_crc32_update(state, (const uint8_t *)"\0", 1);
	}

	return keeb_crc32_final(state);
}

static int keeb_tokens_init(void)
{
	cached_hash = build_hash();
	cached_hash_valid = true;

	LOG_INF("keeb engine: %zu bindable behaviors, hash 0x%08x", ARRAY_SIZE(token_table),
		cached_hash);

	for (size_t i = 0; i < ARRAY_SIZE(token_table); i++) {
		if (!zmk_behavior_get_binding(token_table[i].name)) {
			/* Not an error: devicetree keeps a behavior node alive
			 * because the token list references it, while its driver
			 * may be switched off. keeb_token_ready() reports it and
			 * the configurator leaves it out of the picker.
			 */
			LOG_WRN("token %u (%s): no driver in this build", token_table[i].id,
				token_table[i].name);
		}
	}

	return 0;
}

SYS_INIT(keeb_tokens_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);

uint16_t keeb_token_count(void)
{
	return (uint16_t)ARRAY_SIZE(token_table);
}

uint32_t keeb_token_hash(void)
{
	if (!cached_hash_valid) {
		cached_hash = build_hash();
		cached_hash_valid = true;
	}

	return cached_hash;
}

const struct keeb_token *keeb_token_get(uint16_t id)
{
	if (id >= ARRAY_SIZE(token_table)) {
		return NULL;
	}

	return &token_table[id];
}

const struct keeb_token *keeb_token_by_name(const char *name)
{
	if (!name) {
		return NULL;
	}

	for (size_t i = 0; i < ARRAY_SIZE(token_table); i++) {
		if (strcmp(token_table[i].name, name) == 0) {
			return &token_table[i];
		}
	}

	return NULL;
}

bool keeb_token_ready(uint16_t id)
{
	const struct keeb_token *token = keeb_token_get(id);

	return token && zmk_behavior_get_binding(token->name);
}
