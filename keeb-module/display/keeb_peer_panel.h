/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * The other half's panel, as seen from the central.
 *
 * A split peripheral has no host connection and no config engine, so the host
 * attached to the central cannot talk to it directly. This module keeps the
 * peer panel's table and text on the central - persisted under its own
 * "keebpeer" settings key - answers the KEEB_T_PEER_DISPLAY_* records from that
 * copy, and pushes it to the peripheral over the keeb,panel split behaviour.
 *
 * The peripheral's copy is RAM only: the central is the half with a host and
 * with the panel's settings subtree, so it is the single source of truth, and
 * a peripheral that boots alone shows its compiled-in preset until the link
 * comes up and the central re-pushes the saved table (layer_sync.c, connect
 * edge).
 *
 * What a host may write is exactly what it may write on the connected panel:
 * the widget table and the text slots. Live value slots are not relayed, so the
 * peer panel reports value_slots = 0 and the configurator does not offer them.
 */

#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "../proto/keeb_tlv.h"

/** True when this build can read and write the peer panel. */
bool keeb_peer_panel_available(void);

/** Fill a keeb_display_info record with the peer panel's real limits. */
void keeb_peer_panel_info(struct keeb_display_info *info);

/** Append a KEEB_T_PEER_DISPLAY record: header, widgets, then text slots. */
int keeb_peer_panel_dump(struct keeb_tlv_msg *msg);

/** Apply a whole KEEB_T_PEER_DISPLAY_SET payload, validated against the
 * geometry the peripheral draws in. */
int keeb_peer_panel_set_table(const uint8_t *data, uint16_t len, uint16_t *applied);

/** Apply a KEEB_T_PEER_TEXT_SET payload. */
int keeb_peer_panel_set_text(const uint8_t *data, uint16_t len);

/** Persist / drop / clear the peer panel, and blank the peripheral once. */
int keeb_peer_panel_save(void);
int keeb_peer_panel_discard(void);
int keeb_peer_panel_reset(void);
int keeb_peer_panel_blank(void);

/** True when the running peer table differs from what is saved. */
bool keeb_peer_panel_dirty(void);

/** Push the running table to the peripheral (called on the connect edge). */
void keeb_peer_panel_push(void);
