/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>

#include "art/bongo_art.h"
#include "bongo.h"

/* Idle breathes slowly, typing paws move at 4 fps. */
#define BONGO_IDLE_MS 500
#define BONGO_FAST_MS 250

const lv_image_dsc_t *keeb_bongo_frame(uint8_t wpm, int64_t now_ms) {
	if (wpm == 0) {
		return keeb_bongo_idle[(uint8_t)((now_ms / BONGO_IDLE_MS) % BONGO_IDLE_COUNT)];
	}

	if (wpm < KEEB_BONGO_FAST_WPM) {
		return keeb_bongo_slow[0];
	}

	return keeb_bongo_fast[(uint8_t)((now_ms / BONGO_FAST_MS) % BONGO_FAST_COUNT)];
}
