/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#pragma once

#include <zephyr/types.h>

#include <lvgl.h>

/**
 * Artwork of a layer, as an A8 stencil (255 = ink, 0 = paper).
 * Layers beyond the generated set reuse the last artwork.
 */
const lv_image_dsc_t *keeb_layer_art(uint8_t layer);
