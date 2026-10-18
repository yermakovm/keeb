/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#pragma once

#include <stdint.h>

/* Drive this half's RGB status LED with the color mapped to layer N.
 * Called from the layer_art behaviour (both halves) and, on the central
 * half, directly from zmk_layer_state_changed. */
void keeb_layer_indicate(uint8_t layer);
