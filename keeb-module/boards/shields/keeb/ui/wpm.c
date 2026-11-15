/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#include <string.h>

#include "wpm.h"

/* The window arithmetic below is the part that has to be right, and it is the
 * part a keyboard makes expensive to test: tools/wpm_test.c compiles this file
 * for the host with KEEB_WPM_HOST_TEST and drives it with a fake clock. */
#ifndef KEEB_WPM_HOST_TEST
#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>

#include <dt-bindings/zmk/hid_usage_pages.h>

#include <zmk/event_manager.h>
#include <zmk/events/keycode_state_changed.h>
#else
#define MIN(a, b) ((a) < (b) ? (a) : (b))
int64_t keeb_wpm_test_now(void);
#define k_uptime_get() keeb_wpm_test_now()
#endif

/* Seconds the rate averages over. Long enough to be readable, short enough
 * that the cat stops typing when you stop. */
#define WPM_WINDOW 10

/* Keystrokes per word, the usual typing-test convention. */
#define WPM_CHARS_PER_WORD 5

static uint8_t presses[WPM_WINDOW];
static uint8_t slot;
static int64_t last_roll;

void keeb_wpm_press(void) {
	presses[slot]++;
}

static void roll(int64_t now) {
	int64_t seconds = (now - last_roll) / 1000;

	if (seconds <= 0) {
		return;
	}

	if (seconds >= WPM_WINDOW) {
		/* Everything in the window is older than the window: empty it and
		 * start again from now. Walking it forward one window at a time would
		 * leave last_roll behind real time and blank the next few samples -
		 * which is exactly what a pause longer than the window looked like. */
		memset(presses, 0, sizeof(presses));
		slot = 0;
		last_roll = now;
		return;
	}

	for (int64_t i = 0; i < seconds; i++) {
		slot = (uint8_t)((slot + 1) % WPM_WINDOW);
		presses[slot] = 0;
	}

	last_roll += seconds * 1000;
}

/* Central only: hid.c, which raises these events, is not built on a peripheral.
 *
 * Counting keycode events rather than positions: a layer key or a mouse move is
 * not typing. short: the rate counts every keycode, so a held key's repeat is
 * included; fine for a readout that drives a cat. */
#ifndef KEEB_WPM_HOST_TEST
#if !IS_ENABLED(CONFIG_ZMK_SPLIT) || IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
static int keycode_cb(const zmk_event_t *eh) {
	const struct zmk_keycode_state_changed *ev = as_zmk_keycode_state_changed(eh);

	if (ev && ev->state && ev->usage_page == HID_USAGE_KEY) {
		keeb_wpm_press();
	}

	return 0;
}

ZMK_LISTENER(keeb_wpm, keycode_cb);
ZMK_SUBSCRIPTION(keeb_wpm, zmk_keycode_state_changed);
#endif /* central */
#endif /* KEEB_WPM_HOST_TEST */

uint8_t keeb_wpm_value(void) {
	const int64_t now = k_uptime_get();
	uint32_t sum = 0;

	/* A gap at least as long as the window leaves nothing to measure: the ring
	 * is older than the window, so it is emptied rather than summed. */
	if (now - last_roll >= WPM_WINDOW * 1000) {
		roll(now);
		return 0;
	}

	/* Sum before rolling: the bucket that is about to age out still belongs to
	 * the last ten seconds. Rolling first would measure nine of them. */
	for (int i = 0; i < WPM_WINDOW; i++) {
		sum += presses[i];
	}

	roll(now);

	/* chars / 5 per minute over a 10 s window: sum * 60 / 50. */
	return (uint8_t)MIN(sum * 60 / (WPM_CHARS_PER_WORD * WPM_WINDOW), 255);
}
