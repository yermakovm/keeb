/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Config engine: dispatches received KEEB TLV messages to the keymap and
 * system handlers, and sends replies and event notifications over whatever
 * transport is attached. Written from scratch; ZMK Studio is not involved (the
 * protobuf RPC, its subsystem tables and its transports are not compiled).
 *
 * Threading model: nothing is applied in Bluetooth receive context. A received
 * message only completes reassembly and wakes the engine work item; the writes
 * into ZMK's keymap and the settings saves happen on the system work queue,
 * same as ZMK's own settings work. Notifications to the host queue through a
 * message queue so an event burst cannot block the caller.
 */

#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "../proto/keeb_tlv.h"

/** Attach the outgoing transport. Called by the BLE transport at its init. */
void keeb_engine_set_transport(const struct keeb_tlv_tx_dev *dev);

/** One received packet, exactly as the transport delivered it. Runs in
 * Bluetooth receive context, so it only decodes and queues.
 */
void keeb_engine_rx(const uint8_t *pkt, uint16_t pkt_len);

/** Queue an event notification (KEEB_EV_*). Safe from any context; drops with a
 * log message when the queue is full, which is the correct behaviour for an
 * event channel (a missed layer-change event is not a broken keyboard).
 */
int keeb_engine_notify(uint16_t event, const void *data, uint16_t len);

/** True when a transport is attached. */
bool keeb_engine_tx_ready(void);
