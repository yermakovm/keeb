/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Editable buzzer tunes: the TLV face and the "keeb/sound" settings subtree.
 *
 * See keeb_sound.h for why this is a separate module from buzzer/, and
 * keeb_tlv_records.h for the payloads. The model is the panel's and the
 * settings' one: a boot starts from the driver's compiled-in shapes,
 * KEEB_T_TUNE_SET / KEEB_T_SOUND_MAP_SET rewrite RAM, and only
 * KEEB_T_SETTINGS_SAVE writes flash. DISCARD puts the compiled-in shapes back
 * and deletes the saved copy.
 *
 * The blob below is the persisted form, not a second source of truth: the
 * driver's RAM is what a tone reads, and every save serialises from it. That is
 * why there is no dirty flag on the wire - the configurator keeps its own
 * draft, exactly as the settings page does.
 */

#include "keeb_sound.h"

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#if IS_ENABLED(CONFIG_SETTINGS)
#include <zephyr/settings/settings.h>
#endif

#include <string.h>

#include <zmk/buzzer.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#ifdef CONFIG_KEEB_SOUND

#define KEEB_SOUND_SUBTREE "keeb/sound"
#define KEEB_SOUND_KEY "keeb/sound/data"

/* A new layout means a new version, and a version this build does not know is
 * ignored rather than misread - the same rule keeb_settings applies by seeding
 * a short blob with the build's own values. */
#define KEEB_SOUND_MAGIC 0x4bu /* 'K' */
#define KEEB_SOUND_VERSION 1u

/* The driver's order is the wire order. If either list ever changes, both the
 * host and this file have to change together - which is exactly what these
 * asserts refuse to let happen quietly. */
BUILD_ASSERT(ZMK_BUZZER_TUNE_COUNT == KEEB_SOUND_TUNE_COUNT,
	     "enum zmk_buzzer_tune and KEEB_SOUND_TUNE_COUNT disagree");
BUILD_ASSERT(ZMK_BUZZER_EVENT_COUNT == KEEB_SOUND_EVENT_COUNT,
	     "enum zmk_buzzer_event and KEEB_SOUND_EVENT_COUNT disagree");
BUILD_ASSERT(ZMK_BUZZER_STEPS_MAX == KEEB_SOUND_STEPS_MAX,
	     "ZMK_BUZZER_STEPS_MAX and KEEB_SOUND_STEPS_MAX disagree");
BUILD_ASSERT(sizeof(struct zmk_buzzer_step) == sizeof(struct keeb_tune_step),
	     "the driver's step and the wire step have different sizes");

/* One flash value per save, so a tune edit can never be persisted half-applied. */
struct keeb_sound_blob {
	uint8_t magic;
	uint8_t version;
	uint8_t map[KEEB_SOUND_EVENT_COUNT];
	uint8_t count[KEEB_SOUND_TUNE_COUNT];
	struct keeb_tune_step step[KEEB_SOUND_TUNE_COUNT][KEEB_SOUND_STEPS_MAX];
};

/* --------------------------------------------------------------------------
 * Serialising the driver's RAM
 * -------------------------------------------------------------------------- */

static int fill_blob(struct keeb_sound_blob *b)
{
	struct zmk_buzzer_step steps[ZMK_BUZZER_STEPS_MAX];

	memset(b, 0, sizeof(*b));
	b->magic = KEEB_SOUND_MAGIC;
	b->version = KEEB_SOUND_VERSION;

	for (int tune = 0; tune < ZMK_BUZZER_TUNE_COUNT; tune++) {
		uint8_t count = 0;
		int err = zmk_buzzer_tune_get((enum zmk_buzzer_tune)tune, steps, &count);

		if (err) {
			return err;
		}

		b->count[tune] = count;

		for (uint8_t i = 0; i < count; i++) {
			b->step[tune][i].pitch_pct = steps[i].pitch_pct;
			b->step[tune][i].on_ms = steps[i].on_ms;
			b->step[tune][i].gap_ms = steps[i].gap_ms;
		}
	}

	for (int event = 0; event < ZMK_BUZZER_EVENT_COUNT; event++) {
		b->map[event] = (uint8_t)zmk_buzzer_event_tune((enum zmk_buzzer_event)event);
	}

	return 0;
}

/* Apply a blob to the driver. The driver validates every step and refuses a
 * whole tune it cannot use, so an entry this build cannot run makes the restore
 * fall back to the compiled-in shapes instead of leaving a mixed table behind. */
static void apply_blob(const struct keeb_sound_blob *b)
{
	struct zmk_buzzer_step steps[ZMK_BUZZER_STEPS_MAX];
	int err = 0;

	for (int tune = 1; tune < ZMK_BUZZER_TUNE_COUNT && !err; tune++) {
		uint8_t count = b->count[tune];

		if (count > ZMK_BUZZER_STEPS_MAX) {
			err = -EINVAL;
			break;
		}

		for (uint8_t i = 0; i < count; i++) {
			steps[i].pitch_pct = b->step[tune][i].pitch_pct;
			steps[i].on_ms = b->step[tune][i].on_ms;
			steps[i].gap_ms = b->step[tune][i].gap_ms;
		}

		err = zmk_buzzer_tune_set((enum zmk_buzzer_tune)tune, steps, count);
	}

	for (int event = 0; event < ZMK_BUZZER_EVENT_COUNT && !err; event++) {
		err = zmk_buzzer_event_set_tune((enum zmk_buzzer_event)event,
						(enum zmk_buzzer_tune)b->map[event]);
	}

	if (err) {
		LOG_WRN("saved tunes are not playable by this build (%d), keeping the defaults",
			err);
		zmk_buzzer_tune_defaults();
	}
}

/* --------------------------------------------------------------------------
 * Wire records
 * -------------------------------------------------------------------------- */

int keeb_sound_tune_set(const uint8_t *data, uint16_t len)
{
	if (data == NULL || len < sizeof(struct keeb_tune_hdr)) {
		return -KEEB_ERR_BAD_LEN;
	}

	struct keeb_tune_hdr hdr;
	struct keeb_tune_step in[KEEB_SOUND_STEPS_MAX];
	struct zmk_buzzer_step steps[ZMK_BUZZER_STEPS_MAX];

	memcpy(&hdr, data, sizeof(hdr));

	if (hdr.count == 0 || hdr.count > KEEB_SOUND_STEPS_MAX ||
	    len < sizeof(hdr) + (uint16_t)(hdr.count * sizeof(struct keeb_tune_step))) {
		return -KEEB_ERR_BAD_LEN;
	}

	memcpy(in, data + sizeof(hdr), hdr.count * sizeof(struct keeb_tune_step));

	for (uint8_t i = 0; i < hdr.count; i++) {
		steps[i].pitch_pct = in[i].pitch_pct;
		steps[i].on_ms = in[i].on_ms;
		steps[i].gap_ms = in[i].gap_ms;
	}

	int err = zmk_buzzer_tune_set((enum zmk_buzzer_tune)hdr.tune, steps, hdr.count);

	if (err == -ENODEV) {
		return -KEEB_ERR_NOT_SUPPORTED;
	}

	return err ? -KEEB_ERR_OUT_OF_RANGE : 0;
}

int keeb_sound_map_set(const uint8_t *data, uint16_t len)
{
	if (data == NULL || len < sizeof(struct keeb_sound_map)) {
		return -KEEB_ERR_BAD_LEN;
	}

	struct keeb_sound_map rec;

	memcpy(&rec, data, sizeof(rec));

	int err = zmk_buzzer_event_set_tune((enum zmk_buzzer_event)rec.event,
					    (enum zmk_buzzer_tune)rec.tune);

	if (err == -ENODEV) {
		return -KEEB_ERR_NOT_SUPPORTED;
	}

	return err ? -KEEB_ERR_OUT_OF_RANGE : 0;
}

int keeb_sound_play(const uint8_t *data, uint16_t len)
{
	if (data == NULL || len < sizeof(struct keeb_sound_play)) {
		return -KEEB_ERR_BAD_LEN;
	}

	struct keeb_sound_play rec;

	memcpy(&rec, data, sizeof(rec));

	if (rec.tune >= KEEB_SOUND_TUNE_COUNT) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	int err = zmk_buzzer_play_tune((enum zmk_buzzer_tune)rec.tune, NULL);

	if (err == -ENODEV) {
		return -KEEB_ERR_NOT_SUPPORTED;
	}

	/* -EAGAIN: the half is heading into sleep, so nothing may drive the pad. */
	return err ? -KEEB_ERR_BUSY : 0;
}

int keeb_sound_dump(struct keeb_tlv_msg *msg)
{
	for (int event = 0; event < KEEB_SOUND_EVENT_COUNT; event++) {
		struct keeb_sound_map *rec =
			keeb_tlv_rec_add(msg, KEEB_T_SOUND_MAP, sizeof(*rec));

		if (rec == NULL) {
			return -KEEB_ERR_TOO_BIG;
		}

		rec->event = (uint8_t)event;
		rec->tune = (uint8_t)zmk_buzzer_event_tune((enum zmk_buzzer_event)event);
	}

	struct zmk_buzzer_step steps[ZMK_BUZZER_STEPS_MAX];

	for (int tune = 0; tune < KEEB_SOUND_TUNE_COUNT; tune++) {
		uint8_t count = 0;

		if (zmk_buzzer_tune_get((enum zmk_buzzer_tune)tune, steps, &count)) {
			return -KEEB_ERR_NOT_SUPPORTED;
		}

		struct keeb_tune_hdr *hdr = keeb_tlv_rec_add(
			msg, KEEB_T_TUNE,
			(uint16_t)(sizeof(*hdr) + count * sizeof(struct keeb_tune_step)));

		if (hdr == NULL) {
			return -KEEB_ERR_TOO_BIG;
		}

		hdr->tune = (uint8_t)tune;
		hdr->count = count;
		hdr->rsvd = 0;

		struct keeb_tune_step *out = (struct keeb_tune_step *)(hdr + 1);

		for (uint8_t i = 0; i < count; i++) {
			out[i].pitch_pct = steps[i].pitch_pct;
			out[i].on_ms = steps[i].on_ms;
			out[i].gap_ms = steps[i].gap_ms;
		}
	}

	return 0;
}

/* --------------------------------------------------------------------------
 * Persistence
 * -------------------------------------------------------------------------- */

int keeb_sound_save(void)
{
#if !IS_ENABLED(CONFIG_SETTINGS)
	return -KEEB_ERR_NOT_SUPPORTED;
#else
	struct keeb_sound_blob blob;
	int err = fill_blob(&blob);

	if (err) {
		return err == -ENODEV ? -KEEB_ERR_NOT_SUPPORTED : -KEEB_ERR_STORAGE;
	}

	err = settings_save_one(KEEB_SOUND_KEY, &blob, sizeof(blob));

	if (err) {
		LOG_ERR("tune save failed (%d)", err);
		return -KEEB_ERR_STORAGE;
	}

	LOG_INF("buzzer tunes saved to flash");

	return 0;
#endif
}

int keeb_sound_discard(void)
{
	zmk_buzzer_tune_defaults();

#if IS_ENABLED(CONFIG_SETTINGS)
	settings_delete(KEEB_SOUND_KEY);
#endif

	LOG_INF("buzzer tunes reverted to defaults");

	return 0;
}

uint32_t keeb_sound_capabilities(void)
{
	return KEEB_INFO_F_SOUND;
}

#if IS_ENABLED(CONFIG_SETTINGS)

static struct keeb_sound_blob pending_blob;
static bool pending_has_blob;

static int keeb_sound_set_handler(const char *name, size_t len, settings_read_cb read_cb,
				  void *cb_arg)
{
	const char *next;

	if (settings_name_steq(name, "data", &next) && !next) {
		if (len != sizeof(pending_blob)) {
			LOG_WRN("saved tune blob is %u bytes, this build wants %u, ignoring", (unsigned)len,
				(unsigned)sizeof(pending_blob));
			return -EINVAL;
		}

		int err = read_cb(cb_arg, &pending_blob, sizeof(pending_blob));

		if (err <= 0) {
			LOG_ERR("tune settings read from flash failed (%d)", err);
			return err;
		}

		pending_has_blob = true;
		return 0;
	}

	return -ENOENT;
}

static int keeb_sound_commit_handler(void)
{
	if (pending_has_blob) {
		if (pending_blob.magic == KEEB_SOUND_MAGIC &&
		    pending_blob.version == KEEB_SOUND_VERSION) {
			apply_blob(&pending_blob);
			LOG_INF("buzzer tunes loaded from flash");
		} else {
			LOG_WRN("saved tunes are not a layout this build knows, keeping the defaults");
		}

		pending_has_blob = false;
	}

	return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(keeb_sound_store, KEEB_SOUND_SUBTREE, NULL,
			       keeb_sound_set_handler, keeb_sound_commit_handler, NULL);

#endif /* CONFIG_SETTINGS */

#endif /* CONFIG_KEEB_SOUND */
