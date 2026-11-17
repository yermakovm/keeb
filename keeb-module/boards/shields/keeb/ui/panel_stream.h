/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * The byte stream the central pushes to the peripheral's panel.
 *
 * Both halves share this header so the framing and the checksum cannot drift:
 * the central (display/keeb_peer_panel.c) builds and sends it, the peripheral
 * (ui/behavior_keeb_panel.c) reassembles and applies it.
 *
 * The split behaviour carries two uint32_t per invocation, so a stream is sent
 * as:
 *   invocation 0: param1 = magic | version << 8 | length << 16
 *                 param2 = CRC-32 of the payload
 *   invocation N: param1 = payload bytes 0..3, param2 = payload bytes 4..7
 *
 * Any invocation that carries the magic byte, the version and a plausible
 * length starts a new stream, even one that is already half-received; a payload
 * byte that happens to equal the magic does not match the version as well. A
 * stream is therefore never left parked: if a frame goes missing mid-stream the
 * buffer is thrown away by its CRC, and the next push starts clean instead of
 * being appended to the wreckage. What that costs is one apply that does not
 * land, which is why the central re-pushes the table after the connect edge
 * (ui/layer_sync.c) - there is no acknowledgement coming back from the
 * peripheral to tell it to retry sooner.
 */

#pragma once

#include <stdint.h>

/** Longest payload: table kind + count + 24 widgets + 8 slot lengths + text. */
#define KEEB_PANEL_STREAM_MAX 384u

#define KEEB_PANEL_STREAM_MAGIC 0x4bu /* 'K' */
#define KEEB_PANEL_STREAM_VERSION 1u

/** Payload kinds. */
#define KEEB_PANEL_STREAM_TABLE 1u /* count, widgets, then slot length + text */
#define KEEB_PANEL_STREAM_BLANK 2u /* blank the glass once */

/** Header word: the receiver's "this is a new stream" marker. */
#define KEEB_PANEL_STREAM_HDR(len)                                                                 \
	((uint32_t)KEEB_PANEL_STREAM_MAGIC | ((uint32_t)KEEB_PANEL_STREAM_VERSION << 8) |          \
	 ((uint32_t)(len) << 16))

/** CRC-32/IEEE, the same bitwise algorithm as proto/keeb_tlv.c. Inline because
 * the peripheral does not link the TLV codec. */
static inline uint32_t keeb_panel_crc32(const uint8_t *data, uint16_t len) {
	uint32_t crc = 0xffffffffu;

	for (uint16_t i = 0; i < len; i++) {
		crc ^= data[i];

		for (int bit = 0; bit < 8; bit++) {
			crc = (crc >> 1) ^ (0xedb88320u & (uint32_t)-(int32_t)(crc & 1u));
		}
	}

	return ~crc;
}
