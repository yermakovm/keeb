/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Runtime settings overrides held in RAM and exposed over the TLV channel.
 *
 * Values that started as Kconfig #defines (e.g. CONFIG_ZMK_IDLE_SLEEP_TIMEOUT)
 * are kept in mutable RAM so the web configurator can change them without a
 * rebuild.  If CONFIG_SETTINGS is enabled they are also persisted to flash.
 *
 * Built on both halves.  Only the central holds the host connection, so the
 * peripheral learns about a change through keeb_settings_relay(): the central
 * pushes its effective values over ZMK's split transport and each half applies
 * and persists its own copy.  See keeb_settings.c for what travels.
 *
 * The module depends on four small ZMK patches in zmk-patches/: activity timers,
 * display blanking, matrix debounce and hold-tap timings all became runtime
 * values there, because ZMK reads them from flash-resident config structs.
 */

#ifndef KEEB_MODULE_SETTINGS_H
#define KEEB_MODULE_SETTINGS_H

#include <stdbool.h>
#include <stdint.h>

#include "../proto/keeb_tlv.h"

#ifdef CONFIG_KEEB_SETTINGS

/**
 * How the central told a peripheral to treat the values it is pushing.
 * Carried in the behaviour invocation's `position` field (it is not a key
 * position), packed into one byte together with the group and the booleans -
 * see KEEB_RELAY_WIRE below.
 */
#define KEEB_RELAY_APPLY 0u   /* live only: a reboot brings this half's build values back */
#define KEEB_RELAY_SAVE 1u    /* also persist on that half */
#define KEEB_RELAY_DISCARD 2u /* also delete that half's saved copy */

/*
 * The split payload carries two uint32_t per behaviour invocation, so the
 * settings travel two at a time and the group id shares `position` with the op.
 *
 * `position` is ONE BYTE on the wire (zmk_split_run_behavior_data.position is
 * uint8_t - zmk/app/include/zmk/split/bluetooth/service.h), so the word has to
 * fit in 8 bits. It used to be op | group << 8 | booleans << 16, which arrived as
 * 0 for every group: the peripheral only ever saw "group 0, APPLY, no booleans"
 * and the LED colors never left the central.
 *   position = op | (group << 2) | (boolean settings << 5)   (7 bits)
 */
#define KEEB_RELAY_GROUP_TIMEOUTS 0u /* idle_timeout_ms, sleep_timeout_ms */
#define KEEB_RELAY_GROUP_MATRIX 1u   /* debounce press, debounce release */
#define KEEB_RELAY_GROUP_LED_RGB 2u  /* led red, led green */
#define KEEB_RELAY_GROUP_LED_OTHER 3u /* led blue, led brightness */
/* The per-layer colors travel two layers at a time, same payload budget. */
#define KEEB_RELAY_GROUP_LED_LAYER_01 4u /* layer colors 0 and 1 */
#define KEEB_RELAY_GROUP_LED_LAYER_23 5u /* layer colors 2 and 3 */
#define KEEB_RELAY_GROUP_LED_LAYER_45 6u /* layer colors 4 and 5 */
#define KEEB_RELAY_GROUP_LED_LAYER_67 7u /* layer colors 6 and 7 */
#define KEEB_RELAY_GROUP_COUNT 8u

#define KEEB_RELAY_WIRE(op, group, booleans)                                                       \
	(((uint32_t)(op) & 0x03u) | (((uint32_t)(group) & 0x07u) << 2) |                           \
	 (((uint32_t)(booleans) & 0x03u) << 5))
#define KEEB_RELAY_OP_OF(wire) ((uint8_t)((wire) & 0x03u))
#define KEEB_RELAY_GROUP_OF(wire) ((uint8_t)(((wire) >> 2) & 0x07u))
#define KEEB_RELAY_BOOLS_OF(wire) ((uint8_t)(((wire) >> 5) & 0x03u))

/* Encoding and decoding live side by side, and the word has to survive the
 * byte-wide split position: widening it again would be silent, and this bug was
 * exactly that kind of silence. */
_Static_assert(KEEB_RELAY_WIRE(KEEB_RELAY_DISCARD, KEEB_RELAY_GROUP_COUNT - 1,
			       KEEB_SETTINGS_B_ALL) <= 0xffu,
	       "the relay word has to fit the one-byte position on the split wire");
_Static_assert(KEEB_RELAY_GROUP_OF(
		       KEEB_RELAY_WIRE(KEEB_RELAY_SAVE, KEEB_RELAY_GROUP_LED_LAYER_67, KEEB_SETTINGS_B_ALL)) ==
		       KEEB_RELAY_GROUP_LED_LAYER_67,
	       "relay word encode/decode drifted");

/** Initialize settings subsystem. Called from SYS_INIT. */
int keeb_settings_init(void);

/** Fill a keeb_settings struct with current effective values. */
void keeb_settings_get(struct keeb_settings *out);

/** Apply settings from a TLV payload (KEEB_T_SETTINGS_SET). Returns 0 or -KEEB_ERR_*. */
int keeb_settings_set(const uint8_t *data, uint16_t len);

/** Persist current settings to flash. Returns 0 or -KEEB_ERR_*. */
int keeb_settings_save(void);

/** Revert to compiled-in defaults (from Kconfig). Returns 0 or -KEEB_ERR_*. */
int keeb_settings_discard(void);

/** Central half: ship the current effective values to every peripheral. */
void keeb_settings_relay(uint8_t op);

/** Peripheral half: apply what the central relayed. Returns 0 or -KEEB_ERR_*. */
int keeb_settings_relay_apply(uint32_t first, uint32_t second, uint32_t wire);

/** Add current settings as a KEEB_T_SETTINGS record to msg. Returns 0 or -KEEB_ERR_*. */
int keeb_settings_dump(struct keeb_tlv_msg *msg);

/** Whether settings have been modified from compiled-in defaults. */
bool keeb_settings_dirty(void);

/** Capability bit for keeb_info.flags when this namespace is compiled in. */
uint32_t keeb_settings_capabilities(void);

/*
 * The status LED color of one keyboard layer, 0x00RRGGBB, 0 = LED off while
 * that layer is active.  Indexed by keymap layer index and pinned to it, and
 * separate from the three palette colors above: those are the BLE/status
 * signals (error / connected / advertising) and a layer color never moves them.
 *
 * Compiled-in defaults, also what a build without the settings channel uses:
 * home off, then green, blue, green, blue for the four non-home layers.
 */
#define KEEB_LED_DEFAULT_COLORS                                                                    \
	0u, 0x0000FF00u, 0x000000FFu, 0x0000FF00u, 0x000000FFu, 0u, 0u, 0u

uint32_t keeb_settings_layer_color(uint8_t index);

#else /* !CONFIG_KEEB_SETTINGS */

static inline int keeb_settings_init(void)
{
	return 0;
}
static inline void keeb_settings_get(struct keeb_settings *out)
{
	(void)out;
}
static inline int keeb_settings_set(const uint8_t *data, uint16_t len)
{
	(void)data;
	(void)len;
	return -KEEB_ERR_NOT_SUPPORTED;
}
static inline int keeb_settings_save(void)
{
	return -KEEB_ERR_NOT_SUPPORTED;
}
static inline int keeb_settings_discard(void)
{
	return -KEEB_ERR_NOT_SUPPORTED;
}
static inline void keeb_settings_relay(uint8_t op)
{
	(void)op;
}
static inline int keeb_settings_relay_apply(uint32_t first, uint32_t second, uint32_t wire)
{
	(void)first;
	(void)second;
	(void)wire;
	return -KEEB_ERR_NOT_SUPPORTED;
}
static inline int keeb_settings_dump(struct keeb_tlv_msg *msg)
{
	(void)msg;
	return -KEEB_ERR_NOT_SUPPORTED;
}
static inline bool keeb_settings_dirty(void)
{
	return false;
}
static inline uint32_t keeb_settings_capabilities(void)
{
	return 0;
}

static inline uint32_t keeb_settings_layer_color(uint8_t index)
{
	static const uint32_t defaults[KEEB_SETTINGS_LED_LAYER_MAX] = {KEEB_LED_DEFAULT_COLORS};

	return index < KEEB_SETTINGS_LED_LAYER_MAX ? defaults[index] : 0u;
}

#endif /* CONFIG_KEEB_SETTINGS */

#endif /* KEEB_MODULE_SETTINGS_H */
