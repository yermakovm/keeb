/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * keeb,panel - "draw this table on the other half's panel".
 *
 * The peripheral holds no host connection and no config engine, so the central
 * keeps the peer panel's table and relays it here. The node is labelled
 * panel_relay; the split payload only carries 8 characters of its node name
 * ("panel"), which is why the label is the long one.
 *
 * The framing lives in panel_stream.h and is shared with the sender. This half
 * reassembles the payload, checks the CRC, and applies the table through the
 * same widget model it always draws from, so the cat and the readouts are the
 * same primitives a compiled-in preset uses.
 *
 * The central's own copy of this driver is a deliberate no-op: a GLOBAL
 * invocation also runs locally, and the central has no peripheral panel to
 * apply it to.
 */

#define DT_DRV_COMPAT keeb_panel

#include <zephyr/device.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include <string.h>

#include <drivers/behavior.h>
#include <zmk/behavior.h>

#include "panel_stream.h"

#if !IS_ENABLED(CONFIG_ZMK_SPLIT) || IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
#define KEEB_PANEL_CENTRAL 1
#else
#define KEEB_PANEL_CENTRAL 0
#endif

#if !KEEB_PANEL_CENTRAL
#include "widget_model.h"
#endif

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#if !KEEB_PANEL_CENTRAL

static uint8_t rx_buf[KEEB_PANEL_STREAM_MAX];
static uint16_t rx_want;
static uint16_t rx_got;
static uint32_t rx_crc;

static void rx_reset(void) {
	rx_want = 0;
	rx_got = 0;
}

/** The whole payload arrived: verify it, then apply it. */
static void rx_apply(void) {
	uint16_t len = rx_want;

	rx_reset();

	if (keeb_panel_crc32(rx_buf, len) != rx_crc) {
		LOG_WRN("peer panel stream failed its CRC, dropped");
		return;
	}

	if (len < 1) {
		return;
	}

	if (rx_buf[0] == KEEB_PANEL_STREAM_BLANK) {
		keeb_ui_blank_once();
		return;
	}

	if (rx_buf[0] != KEEB_PANEL_STREAM_TABLE) {
		LOG_WRN("peer panel stream kind %u unknown, dropped", rx_buf[0]);
		return;
	}

	uint8_t count = rx_buf[1];

	if (count > KEEB_UI_WIDGET_MAX) {
		LOG_WRN("peer panel stream carries %u widgets, refused", count);
		return;
	}

	uint16_t at = 2 + (uint16_t)count * sizeof(struct keeb_widget);

	if (at > len) {
		LOG_WRN("peer panel stream is short for %u widgets", count);
		return;
	}

	struct keeb_widget next[KEEB_UI_WIDGET_MAX];

	memcpy(next, rx_buf + 2, count * sizeof(struct keeb_widget));

	int err = keeb_ui_set_widgets(next, count);

	if (err) {
		/* The central validated against the same rules before sending, so a
		 * refusal here means the two builds disagree (rotation, art, layers). */
		LOG_WRN("peer panel table refused by the widget model (%d)", err);
		return;
	}

	/* The only line that says a push landed: the central cannot see this half's
	 * verdict (it acks its own copy), so this is where a lost stream shows. */
	LOG_INF("peer panel rx: %u widget(s) applied", count);

	for (uint8_t slot = 0; slot < KEEB_UI_TEXT_SLOTS; slot++) {
		if (at >= len) {
			break;
		}

		uint8_t text_len = rx_buf[at++];

		if ((uint16_t)(at + text_len) > len) {
			LOG_WRN("peer panel text slot %u runs past the stream", slot);
			break;
		}

		keeb_ui_set_text(slot, (const char *)(rx_buf + at), text_len);
		at += text_len;
	}
}

/** One relay invocation. Called from the split transport on this half. */
static void panel_rx(uint32_t first, uint32_t second) {
	/* A header starts a stream even when one is already half-received. One frame
	 * lost on the way would otherwise park this receiver for good: every later
	 * push would be appended to that corpse and thrown away by its CRC, which is
	 * exactly what kept the other half's panel frozen while the central acked
	 * every write (it only ever vouches for its own copy).
	 *
	 * A payload byte that happens to equal the magic byte still cannot restart a
	 * stream mid-flight: the version and the length have to agree as well, which
	 * a stray text byte does not manage. */
	if ((first & 0xffu) == KEEB_PANEL_STREAM_MAGIC) {
		uint8_t version = (uint8_t)((first >> 8) & 0xffu);
		uint16_t len = (uint16_t)((first >> 16) & 0xffffu);

		if (version == KEEB_PANEL_STREAM_VERSION && len >= 1 && len <= sizeof(rx_buf)) {
			if (rx_want != 0) {
				LOG_WRN("peer panel stream restarted mid-flight (%u of %u bytes)",
					rx_got, rx_want);
			}

			LOG_INF("peer panel stream: %u bytes", len);

			rx_want = len;
			rx_got = 0;
			rx_crc = second;
			return;
		}

		/* Not a header after all: idle means a stray frame, mid-stream means
		 * payload that began with the magic byte and belongs to what is in
		 * flight. */
		if (rx_want == 0) {
			LOG_WRN("peer panel stream header refused (v%u, %u bytes)", version, len);
			return;
		}
	}

	if (rx_want == 0) {
		return;
	}

	uint8_t chunk[8];

	memcpy(chunk, &first, sizeof(first));
	memcpy(chunk + sizeof(first), &second, sizeof(second));

	for (uint8_t i = 0; i < sizeof(chunk) && rx_got < rx_want; i++) {
		rx_buf[rx_got++] = chunk[i];
	}

	if (rx_got == rx_want) {
		rx_apply();
	}
}

#endif /* !KEEB_PANEL_CENTRAL */

static int panel_binding_pressed(struct zmk_behavior_binding *binding,
				 struct zmk_behavior_binding_event event) {
#if KEEB_PANEL_CENTRAL
	ARG_UNUSED(binding);
	ARG_UNUSED(event);
#else
	ARG_UNUSED(event);
	panel_rx(binding->param1, binding->param2);
#endif

	return ZMK_BEHAVIOR_OPAQUE;
}

static int panel_binding_released(struct zmk_behavior_binding *binding,
				  struct zmk_behavior_binding_event event) {
	ARG_UNUSED(binding);
	ARG_UNUSED(event);

	return ZMK_BEHAVIOR_OPAQUE;
}

static const struct behavior_driver_api panel_driver_api = {
	.locality = BEHAVIOR_LOCALITY_GLOBAL,
	.binding_pressed = panel_binding_pressed,
	.binding_released = panel_binding_released,
};

#define KEEB_PANEL_INST(n)                                                                         \
	BEHAVIOR_DT_INST_DEFINE(n, NULL, NULL, NULL, NULL, POST_KERNEL,                            \
				CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, &panel_driver_api);

DT_INST_FOREACH_STATUS_OKAY(KEEB_PANEL_INST)
