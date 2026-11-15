/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Editable buzzer tunes over the TLV channel, and their persistence.
 *
 * The shapes themselves live in the buzzer driver (RAM, see
 * buzzer/include/zmk/buzzer.h); this module is the protocol face and the
 * "keeb/sound" settings subtree. Keeping the driver free of protocol types is
 * why the two are separate: buzzer/ is a standalone Zephyr module, this file is
 * part of the keyboard's config engine.
 *
 * Central-only, like the rest of the engine, and the buzzer is soldered to the
 * central half - so unlike keeb_settings there is no split relay here. A
 * peripheral has no buzzer and no reason to hold a copy.
 */

#ifndef KEEB_MODULE_SETTINGS_SOUND_H
#define KEEB_MODULE_SETTINGS_SOUND_H

#include <stdint.h>

#include "../proto/keeb_tlv.h"

#ifdef CONFIG_KEEB_SOUND

/** KEEB_T_TUNE_SET: replace one tune's shape. Returns 0 or -KEEB_ERR_*. */
int keeb_sound_tune_set(const uint8_t *data, uint16_t len);

/** KEEB_T_SOUND_MAP_SET: point one event at a tune. Returns 0 or -KEEB_ERR_*. */
int keeb_sound_map_set(const uint8_t *data, uint16_t len);

/** KEEB_T_TUNE_PLAY: preview one tune. Changes nothing (no dirty, no flash). */
int keeb_sound_play(const uint8_t *data, uint16_t len);

/** Persist every tune shape and the event map. Returns 0 or -KEEB_ERR_*. */
int keeb_sound_save(void);

/** Back to the compiled-in shapes, and drop the saved copy. */
int keeb_sound_discard(void);

/** Add the tune table and the event map to a reply. Returns 0 or -KEEB_ERR_*. */
int keeb_sound_dump(struct keeb_tlv_msg *msg);

/** Capability bit for keeb_info.flags when this namespace is compiled in. */
uint32_t keeb_sound_capabilities(void);

#else /* !CONFIG_KEEB_SOUND */

/* The engine is built on the central only, but a central image may leave the
 * buzzer out. Then these records answer "this build does not do sounds". */

static inline int keeb_sound_tune_set(const uint8_t *data, uint16_t len)
{
	(void)data;
	(void)len;
	return -KEEB_ERR_NOT_SUPPORTED;
}
static inline int keeb_sound_map_set(const uint8_t *data, uint16_t len)
{
	(void)data;
	(void)len;
	return -KEEB_ERR_NOT_SUPPORTED;
}
static inline int keeb_sound_play(const uint8_t *data, uint16_t len)
{
	(void)data;
	(void)len;
	return -KEEB_ERR_NOT_SUPPORTED;
}
static inline int keeb_sound_save(void)
{
	return -KEEB_ERR_NOT_SUPPORTED;
}
static inline int keeb_sound_discard(void)
{
	return -KEEB_ERR_NOT_SUPPORTED;
}
static inline int keeb_sound_dump(struct keeb_tlv_msg *msg)
{
	(void)msg;
	return -KEEB_ERR_NOT_SUPPORTED;
}
static inline uint32_t keeb_sound_capabilities(void)
{
	return 0;
}

#endif /* CONFIG_KEEB_SOUND */

#endif /* KEEB_MODULE_SETTINGS_SOUND_H */
