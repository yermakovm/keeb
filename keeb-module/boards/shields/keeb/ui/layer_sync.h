/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#pragma once

#include <stdbool.h>
#include <zephyr/types.h>

#include "../../../../proto/keeb_tlv.h" /* KEEB_DEV_* */

/** True while at least one split peripheral is connected (central half). */
bool keeb_layer_sync_peer_connected(void);

/** Which device this keyboard is talking to, as the status screens show it:
 * KEEB_DEV_NONE, KEEB_DEV_USB, or 1..N for a BLE profile.
 *
 * Computed once, on the central, because that is where ZMK keeps the endpoint:
 * the peripheral gets the same number on its keeb,layer-art push, so both
 * halves can never disagree about which device they are on.
 */
uint8_t keeb_split_device_id(void);
