/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#pragma once

#include "keeb_ui.h"

/** Longest layer name the central panel prints (ZMK's own limit is 10). */
#define KBEEB_LAYER_NAME_MAX 16

/** Snapshot of everything the central (left) panel displays. */
struct keeb_panel_info {
	uint8_t layer;
	char layer_name[KBEEB_LAYER_NAME_MAX];
	uint8_t left_level;
	uint8_t right_level;
	bool right_present;
	bool peer_connected;
	bool host_connected;
	bool charging;
};

/**
 * Implemented by exactly one panel file, selected by the split role:
 * panel_central.c on the central half, panel_peripheral.c on the peripheral.
 */
void keeb_panel_draw(struct keeb_ctx *ctx);
