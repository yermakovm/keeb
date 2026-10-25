/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#pragma once

#include <zephyr/types.h>

/** Request the artwork of layer @p layer on the peripheral display. */
void keeb_art_select(uint8_t layer);

/** Show which device the central is talking to: KEEB_DEV_NONE, KEEB_DEV_USB or
 * 1..N for a BLE profile. Arrives on the same push as the artwork. */
void keeb_device_select(uint8_t id);
