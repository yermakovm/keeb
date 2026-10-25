/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#pragma once

#include "keeb_ui.h"

/** Longest layer name the central panel prints (ZMK's own limit is 20). */
#define KBEEB_LAYER_NAME_MAX 16

/**
 * Implemented by exactly one panel file, selected by the split role:
 * panel_central.c on the central half, panel_peripheral.c on the peripheral.
 *
 * Both fill a `struct keeb_ui_state` from ZMK and hand it to keeb_ui_render(),
 * which paints the widget table (see ui/widget_model.c).
 */
void keeb_panel_draw(struct keeb_ctx *ctx);
