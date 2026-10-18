/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#pragma once

#include <stdbool.h>

/** True while at least one split peripheral is connected (central half). */
bool keeb_layer_sync_peer_connected(void);
