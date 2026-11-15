/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Host test for the typing rate (keeb-module/boards/shields/keeb/ui/wpm.c).
 *
 * The rate is a sliding window over ten seconds that is rolled by whoever happens
 * to ask for a value, so it spends its life being sampled at whatever intervals
 * the system work queue manages. That is exactly the kind of arithmetic that is
 * wrong in ways only a wrist notices - the first version blanked itself for ten
 * seconds after any pause, so the panel read 0 while typing. It is pure C with a
 * clock injected, so it is tested here instead.
 *
 * Build and run: tools/wpm_test.sh
 */

#include <assert.h>
#include <stdio.h>
#include <stdint.h>

#define KEEB_WPM_HOST_TEST
#include "../keeb-module/boards/shields/keeb/ui/wpm.c"

static int64_t now_ms;

int64_t keeb_wpm_test_now(void) { return now_ms; }

/* Between tests: jump past the window and take one sample, which empties it (the
 * counter has no reset of its own - a keyboard never needs one). */
static void reset_rate(void) {
	now_ms += 60000;
	assert(keeb_wpm_value() == 0);
}

/* One second later, with `presses` keystrokes having happened in between. */
static uint8_t second(int presses) {
	now_ms += 1000;

	for (int i = 0; i < presses; i++) {
		keeb_wpm_press();
	}

	return keeb_wpm_value();
}

static void test_steady_typing(void) {
	reset_rate();

	/* 5 keystrokes a second, sampled once a second: a word a second, reached
	 * only once the ten second window is full. */
	for (int second_index = 1; second_index <= 10; second_index++) {
		assert(second(5) == 6 * second_index);
	}

	printf("ok   steady typing ramps to 60 wpm over the window\n");
}

static void test_idle_decays(void) {
	int previous;

	reset_rate();

	for (int i = 1; i <= 10; i++) {
		assert(second(5) == 6 * i);
	}

	/* The window is full: 5 keys a second is a word a second, and it holds. */
	assert(second(5) == 60);

	/* The window is ten seconds wide, so typing fades one second at a time
	 * instead of dropping to zero, and reaches zero exactly when it is empty. */
	previous = 60;

	for (int i = 0; i < 10; i++) {
		const int now = second(0);

		assert(now < previous);
		previous = now;
	}

	assert(previous == 0);

	printf("ok   the rate decays as the window rolls\n");
}

/* The regression: a gap longer than the window used to leave the internal clock
 * behind real time, so every following sample cleared the window again. */
static void test_long_gap_recovers(void) {
	reset_rate();

	/* A minute goes by (a stall, a sleep, an idle spell) with no sampling. */
	now_ms += 60000;
	assert(keeb_wpm_value() == 0);

	/* Typing right after the gap must show up in the very next sample. */
	assert(second(5) == 6);
	assert(second(5) == 12);

	printf("ok   a gap longer than the window recovers on the next sample\n");
}

static void test_capped(void) {
	reset_rate();

	/* 255 is the top of the byte the panel carries. */
	for (int i = 0; i < 9; i++) {
		second(200);
	}

	assert(keeb_wpm_value() == 255);

	printf("ok   the rate saturates at 255\n");
}

int main(void) {
	test_steady_typing();
	test_idle_decays();
	test_long_gap_recovers();
	test_capped();

	printf("wpm: all tests passed\n");
	return 0;
}
