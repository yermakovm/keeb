/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#pragma once

#include <zephyr/types.h>

/** The active layer, as the central sees it: feeds preset 0's artwork widget and
 * the layer LED. It no longer changes which panel is shown. */
void keeb_art_select(uint8_t layer);

/** Show which device the central is talking to: KEEB_DEV_NONE, KEEB_DEV_USB or
 * 1..N for a BLE profile. Arrives on the same push as the artwork. */
void keeb_device_select(uint8_t id);

/**
 * The central's readouts, packed as described in behavior_ui_stat.c:
 * @p packed holds the active profile, the profile count and the host link
 * signal; @p wpm is the central half's typing rate (this half adds its own).
 */
void keeb_ui_stat(uint32_t wpm, uint32_t packed);
