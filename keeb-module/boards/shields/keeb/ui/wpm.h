/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Typing rate, counted per half.
 *
 * Counted on the central only, and counted there for the whole keyboard: a
 * peripheral reports key positions, the central resolves them and is the half
 * that raises keycode events (hid.c is not built on a peripheral). So one
 * counter on the central is the complete typing rate, and the peripheral's
 * panel shows it as it arrives in the keeb,ui-stat push.
 */

#pragma once

#ifdef KEEB_WPM_HOST_TEST
#include <stdint.h>
#else
#include <zephyr/types.h>
#endif

/** One keystroke arrived (a key that produces a keycode, press only). Only
 * the central calls this: a peripheral has no keycode events to count. */
void keeb_wpm_press(void);

/**
 * Words per minute over the last seconds, 0-255. Cheap: it only rolls the
 * window when called, so it needs no timer of its own. Returns 0 on a
 * peripheral, which never counts a keystroke.
 */
uint8_t keeb_wpm_value(void);
