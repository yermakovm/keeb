/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#pragma once

#include <zephyr/types.h>

/** Request the artwork of layer @p layer on the peripheral display. */
void keeb_art_select(uint8_t layer);
