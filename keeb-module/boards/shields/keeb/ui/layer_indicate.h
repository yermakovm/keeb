/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#pragma once

#include <stdint.h>

/* Drive this half's RGB status LED with the color configured for layer N.
 * Called from the layer_art behaviour (both halves) and, on the central
 * half, directly from zmk_layer_state_changed. */
void keeb_layer_indicate(uint8_t layer);

/* Re-apply the color of the layer this half is on, after the settings channel
 * changed a color. No-op when nothing moved. */
void keeb_layer_indicate_refresh(void);
