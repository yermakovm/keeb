/*
 * Copyright (c) 2025 The keeb keyboard authors
 * SPDX-License-Identifier: MIT
 *
 * KEEB TLV wire protocol - records.
 *
 * Namespaces, record type ids, status and error codes, the token sentinels, the
 * display model and every payload struct: the vocabulary a host and the firmware
 * exchange. The framing that carries it is in keeb_tlv_wire.h.
 *
 * Same rule as the framing - packed, little-endian, and asserted at the bottom of
 * this file. The app's copy of these numbers is generated from this header by
 * app/scripts/gen-contract.mjs (app/src/proto/protocol.gen.ts), which re-derives
 * every size from the field list and fails when it disagrees with the assert
 * below. Change a struct and both sides stop building.
 */
#ifndef KEEB_MODULE_PROTO_TLV_RECORDS_H
#define KEEB_MODULE_PROTO_TLV_RECORDS_H

#include <stdbool.h>
#include <stdint.h>

#include "keeb_tlv_wire.h" /* KEEB_PACKED and the version / limit constants */

/* --------------------------------------------------------------------------
 * Namespaces and record types
 * -------------------------------------------------------------------------- */

#define KEEB_NS_SYS 0x0u
#define KEEB_NS_KEYMAP 0x1u
#define KEEB_NS_DISPLAY 0x2u    /* status-screen widget table + its readouts */
#define KEEB_NS_SETTINGS 0x3u   /* unused yet: sleep timeout and friends */
#define KEEB_NS_IMAGE 0x4u      /* unused yet: chunked artwork upload */

#define KEEB_TLV_TYPE(ns, op) (uint16_t)(((ns) << 12) | (op))

/* SYS - session, capability discovery, acknowledgements, events. */
#define KEEB_T_PING KEEB_TLV_TYPE(KEEB_NS_SYS, 0x01)
#define KEEB_T_INFO KEEB_TLV_TYPE(KEEB_NS_SYS, 0x02)
#define KEEB_T_ACK KEEB_TLV_TYPE(KEEB_NS_SYS, 0x03)
#define KEEB_T_NOTIFY KEEB_TLV_TYPE(KEEB_NS_SYS, 0x04)
#define KEEB_T_TOKENS KEEB_TLV_TYPE(KEEB_NS_SYS, 0x05)
#define KEEB_T_TOKEN_PARAMS KEEB_TLV_TYPE(KEEB_NS_SYS, 0x06)

/* KEYMAP - the live layout. */
#define KEEB_T_CELLS_GET KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x01)
#define KEEB_T_CELLS KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x02)
#define KEEB_T_CELLS_SET KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x03)
#define KEEB_T_SAVE KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x04)
#define KEEB_T_DISCARD KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x05)
#define KEEB_T_RESET KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x06)
#define KEEB_T_LAYERS_GET KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x07)
#define KEEB_T_LAYERS KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x08)
#define KEEB_T_LAYER_NAME_SET KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x09)
#define KEEB_T_LAYER_MOVE KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x0a)
#define KEEB_T_LAYER_ADD KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x0b)
#define KEEB_T_LAYER_REMOVE KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x0c)
#define KEEB_T_LAYER_RESTORE KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x0d)
/* Reserved for the staged apply of Phase 2 (0x0e commit, 0x0f cancel). They
 * are named here so the host never invents a conflicting op number.
 */
#define KEEB_T_APPLY_COMMIT KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x0e)
#define KEEB_T_APPLY_CANCEL KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x0f)

/* Tester mode (0x10): ask the keyboard to report every switch it sees.
 *
 * It is a mode and not a subscription that is always on, because a keyboard
 * that streams every keystroke over GATT is a keyboard whose typing is now
 * coupled to a Bluetooth link it does not need. Off is the default, off is
 * what a disconnect leaves behind, and the only cost of being in the mode is
 * one small notification per press and per release.
 */
#define KEEB_T_TEST_SET KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x10)

/* DISPLAY - the status screen's widget table.
 *
 * The panel is not a live LVGL widget tree: the firmware keeps a bounded table
 * of drawing primitives (see struct keeb_widget) and a draw pass that paints
 * that table from a snapshot of ZMK's state. These records edit the table, the
 * fixed strings it can print, and the numbers a host can push into it. The
 * ZMK-owned readouts (layer, battery, link, charging, connected device) stay
 * owned by the firmware: a widget chooses *which* one appears *where*, it can
 * never fake one.
 */
#define KEEB_T_DISPLAY_INFO KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x01)
#define KEEB_T_DISPLAY_GET KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x02)
#define KEEB_T_DISPLAY KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x03)
#define KEEB_T_DISPLAY_SET KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x04)
#define KEEB_T_WIDGET_SET KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x05)
#define KEEB_T_TEXT_SET KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x06)
#define KEEB_T_VALUE_SET KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x07)
#define KEEB_T_PRESET_SET KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x08)
#define KEEB_T_DISPLAY_SAVE KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x09)
#define KEEB_T_DISPLAY_DISCARD KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x0a)
#define KEEB_T_DISPLAY_RESET KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x0b)
#define KEEB_T_DISPLAY_BLANK KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x0c)
/* Sent by the board after KEEB_T_DISPLAY_INFO, one per built-in preset, so the
 * configurator labels presets with the firmware's own names instead of "0/1/2".
 */
#define KEEB_T_PRESET_NAME KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x0d)

/*
 * The other half's panel. A split peripheral has no host connection and no
 * engine, so it cannot answer these itself: the central keeps the peer table,
 * persists it under its own settings key, and relays it over the split link
 * (ui/panel_relay.c + ui/behavior_keeb_panel.c). The payload layouts are the
 * ones above, byte for byte - only the record ids differ, so an old host that
 * sends DISPLAY_* still edits the panel of the half it is plugged into.
 */
#define KEEB_T_PEER_DISPLAY_INFO KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x0e)
#define KEEB_T_PEER_DISPLAY_GET KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x0f)
#define KEEB_T_PEER_DISPLAY KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x10)
#define KEEB_T_PEER_DISPLAY_SET KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x11)
#define KEEB_T_PEER_TEXT_SET KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x12)
#define KEEB_T_PEER_DISPLAY_SAVE KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x13)
#define KEEB_T_PEER_DISPLAY_DISCARD KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x14)
#define KEEB_T_PEER_DISPLAY_RESET KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x15)
#define KEEB_T_PEER_DISPLAY_BLANK KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x16)

/* SETTINGS — runtime Kconfig overrides held in RAM. */
#define KEEB_T_SETTINGS_GET KEEB_TLV_TYPE(KEEB_NS_SETTINGS, 0x01)
#define KEEB_T_SETTINGS KEEB_TLV_TYPE(KEEB_NS_SETTINGS, 0x02)
#define KEEB_T_SETTINGS_SET KEEB_TLV_TYPE(KEEB_NS_SETTINGS, 0x03)
#define KEEB_T_SETTINGS_SAVE KEEB_TLV_TYPE(KEEB_NS_SETTINGS, 0x04)
#define KEEB_T_SETTINGS_DISCARD KEEB_TLV_TYPE(KEEB_NS_SETTINGS, 0x05)
#define KEEB_T_SETTINGS_RESET KEEB_TLV_TYPE(KEEB_NS_SETTINGS, 0x06)
/* Buzzer sounds: the tune shapes and the event -> tune map, held in RAM by the
 * buzzer driver and persisted under their own settings key. They ride the
 * SETTINGS namespace (and its SAVE / DISCARD / RESET verbs) because they are
 * the same kind of thing: build values a host may rewrite without a rebuild. */
#define KEEB_T_TUNE_GET KEEB_TLV_TYPE(KEEB_NS_SETTINGS, 0x07)
#define KEEB_T_TUNE KEEB_TLV_TYPE(KEEB_NS_SETTINGS, 0x08)
#define KEEB_T_TUNE_SET KEEB_TLV_TYPE(KEEB_NS_SETTINGS, 0x09)
#define KEEB_T_SOUND_MAP_GET KEEB_TLV_TYPE(KEEB_NS_SETTINGS, 0x0a)
#define KEEB_T_SOUND_MAP_SET KEEB_TLV_TYPE(KEEB_NS_SETTINGS, 0x0b)
#define KEEB_T_TUNE_PLAY KEEB_TLV_TYPE(KEEB_NS_SETTINGS, 0x0c)
/* TUNE_GET / SOUND_MAP_GET answer with these, one record per tune / per event. */
#define KEEB_T_SOUND_MAP KEEB_TLV_TYPE(KEEB_NS_SETTINGS, 0x0d)

/* --------------------------------------------------------------------------
 * Status and error codes
 * -------------------------------------------------------------------------- */

enum keeb_status {
	KEEB_STATUS_OK = 0,
	KEEB_STATUS_ERR = 1,
};

/* err_code values carried in keeb_ack.err_code (0 when OK). */
#define KEEB_ERR_NONE 0
#define KEEB_ERR_BAD_MAGIC 1
#define KEEB_ERR_BAD_VERSION 2
#define KEEB_ERR_BAD_CRC 3
#define KEEB_ERR_BAD_LEN 4
#define KEEB_ERR_BAD_SEQ 5
#define KEEB_ERR_TOO_BIG 6
#define KEEB_ERR_UNKNOWN_TYPE 7
#define KEEB_ERR_OUT_OF_RANGE 8
#define KEEB_ERR_UNKNOWN_TOKEN 9
#define KEEB_ERR_RESERVED_POSITION 10
#define KEEB_ERR_BEHAVIOR 11
#define KEEB_ERR_STORAGE 12
#define KEEB_ERR_NO_SPACE 13
#define KEEB_ERR_NOT_SUPPORTED 14
#define KEEB_ERR_BUSY 15
#define KEEB_ERR_BAD_WIDGET 16 /* kind/source unknown, or geometry outside the panel */

/* --------------------------------------------------------------------------
 * Tokens: the behaviors a host may bind
 * --------------------------------------------------------------------------
 * A token is an index into the firmware's token table (devicetree
 * keeb,engine:tokens), so the host never names a behavior: it references one
 * by number, and token_hash in keeb_info tells the configurator whether its
 * own table still matches the firmware. A behavior that is not compiled into
 * the image cannot be bound, which is why this indirection exists at all -
 * ZMK resolves a binding by device-name string (zmk_behavior_get_binding).
 */

#define KEEB_TOKEN_NONE 0xffffu /* position has no binding yet */
#define KEEB_TOKEN_UNKNOWN 0xfffeu /* binding the token table does not cover */
#define KEEB_TOKEN_NAME_MAX 16    /* ZMK's split payload limit for these names */

/* Cell flags in keeb_cell.flags / keeb_cell_set.flags. */
#define KEEB_CELL_F_RESERVED 0x01u /* firmware-owned position, writes refused */

/* --------------------------------------------------------------------------
 * On-wire payloads (packed, little-endian)
 * -------------------------------------------------------------------------- */

/** KEEB_T_INFO - what the firmware can do. */
struct KEEB_PACKED keeb_info {
	uint16_t proto;          /* KEEB_TLV_VERSION the firmware speaks */
	uint16_t fw_version;     /* KEEB_FW_VERSION */
	uint16_t layer_count;    /* layer slots in the image (capacity) */
	uint16_t key_count;      /* stock key positions (ZMK_KEYMAP_LEN) */
	uint16_t name_max;       /* CONFIG_ZMK_KEYMAP_LAYER_NAME_MAX_LEN */
	uint16_t token_count;    /* entries in the token table */
	uint32_t token_hash;     /* CRC-32 of the token table, drift detector */
	uint32_t flags;          /* KEEB_INFO_F_* */
};

/** KEEB_T_ACK - one per processed message. */
struct KEEB_PACKED keeb_ack {
	uint16_t msg_id;  /* the message this answers */
	uint8_t status;   /* enum keeb_status */
	uint8_t err_code; /* KEEB_ERR_*, 0 when status is OK */
	uint16_t detail;  /* per-op result, e.g. the new layer index */
	uint32_t extra;   /* per-op result, e.g. the active layer bitmask */
};

/** KEEB_T_NOTIFY header, followed by event-specific bytes. */
struct KEEB_PACKED keeb_notify {
	uint16_t event;
	uint16_t seq;
};

#define KEEB_EV_LAYER_STATE 0x0001u /* payload: uint32_t layer state bitmap */
#define KEEB_EV_CELLS_SET 0x0002u   /* payload: uint8_t layer, uint16_t count */
#define KEEB_EV_SAVED 0x0003u       /* payload: none */
#define KEEB_EV_DISCARDED 0x0004u   /* payload: none (revert chord too) */
#define KEEB_EV_LAYER_CHANGED 0x0005u /* payload: uint8_t layer id */
#define KEEB_EV_DISPLAY_SET 0x0006u   /* payload: uint8_t count, uint8_t flags */
#define KEEB_EV_TEXT_SET 0x0007u      /* payload: uint8_t slot */
#define KEEB_EV_DISPLAY_SAVED 0x0008u /* payload: none */
/* Tester mode only. `pos` is the matrix position, the same number a CELLS
 * record uses; `layer` is the layer the keyboard was on at that instant,
 * included because the press and a layer change can arrive in either order.
 * The keycode is not here: the configurator already holds the cell table, and
 * a firmware that reports a binding it resolved through hold/tap would be
 * reporting something the host cannot compare against the layout it is editing.
 */
#define KEEB_EV_KEY 0x0009u /* payload: uint8_t pos, uint8_t pressed, uint8_t layer */
#define KEEB_EV_SETTINGS_CHANGED 0x000au /* payload: uint16_t flags — which fields changed */
#define KEEB_EV_PEER_DISPLAY_SET 0x000bu /* payload: uint8_t count, uint8_t flags */
#define KEEB_EV_PEER_DISPLAY_SAVED 0x000cu /* payload: none */

/* --------------------------------------------------------------------------
 * Display model: widget kinds, data sources, geometry
 * --------------------------------------------------------------------------
 * These enums are part of the wire format: struct keeb_widget stores a kind and
 * a source, so the values are fixed here rather than in the UI code. Adding a
 * kind or a source is a firmware change; the configurator learns the real set
 * from keeb_display_info rather than assuming it.
 */

/* struct keeb_widget.kind */
enum keeb_widget_kind {
	KEEB_WID_NONE = 0,  /* empty slot: draws nothing */
	KEEB_WID_FRAME = 1, /* rounded 1px outline, style = radius */
	KEEB_WID_RECT = 2,  /* filled rect, style: 0 = ink, 1 = paper */
	KEEB_WID_RULE = 3,  /* horizontal 1px line */
	KEEB_WID_TEXT = 4,  /* style: bits 0-1 font, bits 2-3 align */
	KEEB_WID_BAR = 5,   /* percent bar, source gives the percentage */
	KEEB_WID_BATTERY = 6, /* battery glyph, source gives the percentage */
	KEEB_WID_PIPS = 7,  /* layer pips, style = pip geometry preset */
	KEEB_WID_BOLT = 8,  /* charge bolt, drawn only while charging */
	KEEB_WID_ART = 9,   /* the active layer's artwork, centred in the box */
	KEEB_WID_BONGO = 10, /* placeholder typing cat, animates while typing */
	KEEB_WID_COUNT = 11
};

/* struct keeb_widget.source. A source is a value the firmware reads from ZMK at
 * draw time; KEEB_SRC_TEXT_BASE+i and KEEB_SRC_VALUE_BASE+i are the slots a
 * host may write. A widget may not name a value the firmware cannot produce.
 */
enum keeb_widget_source {
	KEEB_SRC_NONE = 0,
	KEEB_SRC_LAYER_INDEX = 1,   /* "01" .. "NN" */
	KEEB_SRC_LAYER_NAME = 2,    /* active layer's name */
	KEEB_SRC_LAYER_POS = 3,     /* "LAYER 2 / 5" */
	KEEB_SRC_LAYER_PIPS = 4,    /* pip row: active index + layer count */
	KEEB_SRC_LAYER_ART = 5,     /* artwork of the active layer */
	KEEB_SRC_BATT_LEFT = 6,     /* percentage, for BAR/BATTERY */
	KEEB_SRC_BATT_LEFT_PCT = 7, /* "86%", for TEXT */
	KEEB_SRC_BATT_RIGHT = 8,
	KEEB_SRC_BATT_RIGHT_PCT = 9,
	KEEB_SRC_LINK = 10,   /* "LINK: OK" / "LINK: --" */
	KEEB_SRC_LINK_SHORT = 11, /* "LINK" / "--" */
	KEEB_SRC_HOST = 12,   /* "HOST: READY" / "HOST: --" */
	KEEB_SRC_CHARGING = 13, /* "CHARGING" when powered, else the host text */
	KEEB_SRC_DEVICE_ID = 14, /* connected host: "1".."N", "U" for USB, "--" */
	KEEB_SRC_DEVICE_NAME = 15, /* peer name the firmware knows, else "--" */
	KEEB_SRC_WPM = 16,        /* "0".."255": typing rate of the whole keyboard */
	KEEB_SRC_PROFILE_PIPS = 17, /* BLE profile pips: active index, profile count */
	KEEB_SRC_RSSI = 18,       /* host link signal as a percentage, for BAR */
	KEEB_SRC_TEXT_BASE = 0x20, /* + slot: a string the host wrote */
	KEEB_SRC_VALUE_BASE = 0x40 /* + slot: a number the host wrote */
};

/* struct keeb_widget.style, kind-specific halves. */
#define KEEB_STYLE_FONT(s) ((uint8_t)((s) & 0x3u))    /* 0 small, 1 body, 2 digit */
#define KEEB_STYLE_ALIGN(s) ((uint8_t)(((s) >> 2) & 0x3u)) /* 0 left, 1 centre, 2 right */
#define KEEB_TEXT_STYLE(font, align) (uint8_t)(((font) & 0x3u) | (((align) & 0x3u) << 2))
#define KEEB_RECT_PAPER 1u /* KEEB_WID_RECT: fill with paper instead of ink */

/* KEEB_WID_PIPS pip geometry presets: (pip_w, pip_h, gap). */
#define KEEB_PIPS_SMALL 0  /* 6 x 3, gap 2  - fits 10 pips in 152 px */
#define KEEB_PIPS_LARGE 1  /* 7 x 4, gap 3  - the portrait panel */
#define KEEB_PIPS_TINY 2   /* 5 x 3, gap 2 */

/* struct keeb_widget.style for KEEB_WID_ART: how the artwork is fitted. */
#define KEEB_ART_CENTRE 0 /* centre inside the box, clip what overflows */
#define KEEB_ART_BOTTOM 1 /* align to the bottom edge of the box */

/* KEEB_SRC_RSSI when the central has no BLE host link to measure: the bar
 * draws empty rather than a signal that does not exist. */
#define KEEB_RSSI_INVALID 0xffu

/* KEEB_SRC_PROFILE_PIPS active index when the keyboard is not on a BLE host:
 * no pip is filled. */
#define KEEB_PROFILE_NONE 0xffu

/* KEEB_SRC_DEVICE_ID values the firmware reports (also the split relay's
 * param2 on the keeb,layer-art push). */
#define KEEB_DEV_NONE 0u
#define KEEB_DEV_USB 0x80u

/* --------------------------------------------------------------------------
 * Display payloads
 * --------------------------------------------------------------------------
 */

/** One entry of the widget table. 7 bytes, and the same struct the firmware
 * keeps in RAM and writes to settings - so the settings blob, the wire record
 * and the configurator's model are one layout, not three.
 */
struct KEEB_PACKED keeb_widget {
	uint8_t kind;   /* enum keeb_widget_kind */
	uint8_t source; /* enum keeb_widget_source */
	uint8_t x;
	uint8_t y;
	uint8_t w;
	uint8_t h;
	uint8_t style; /* see KEEB_STYLE_* / KEEB_RECT_PAPER / KEEB_PIPS_* */
};

/** KEEB_T_DISPLAY_INFO - the panel's real limits, so the configurator never
 * hard-codes them. Coordinates are in the *logical* UI space: the panel is
 * 160x68, but a portrait-rotated build lays out 68x160 and rotates the result.
 */
struct KEEB_PACKED keeb_display_info {
	uint8_t editable;    /* 0 = this half's table is fixed (no host writes) */
	uint8_t preset_count;
	uint8_t widget_max;  /* entries the firmware can hold */
	uint8_t text_slots;
	uint8_t text_max;    /* bytes per text slot, excluding NUL */
	uint8_t value_slots;
	uint8_t kind_max;    /* enum keeb_widget_kind values below this are known */
	uint8_t source_max;  /* highest enum keeb_widget_source value */
	uint16_t logical_w;
	uint16_t logical_h;
	uint16_t panel_w;
	uint16_t panel_h;
	uint16_t rotation;   /* degrees the composed UI is rotated by */
	uint8_t widget_size; /* sizeof(struct keeb_widget): layout guard */
	uint8_t flags;     /* KEEB_DISPLAY_INFO_F_* */
	uint8_t layers;    /* how many pips a KEEB_WID_PIPS row draws, i.e.
	                    * KEEB_LAYER_COUNT: the configurator needs it to
	                    * check a pip row fits the panel before it writes */
};

/* This half links the layer artwork, so KEEB_WID_ART is accepted here. On the
 * central it is a Kconfig (CONFIG_KEEB_UI_CENTRAL_ART): the artwork is ~54 KB
 * of A8 stencils, and a panel that only shows readouts should not pay for it. */
#define KEEB_DISPLAY_INFO_F_ART 0x01u

/* This build can also report and edit the *other* half's panel (KEEB_T_PEER_*).
 * Set on the central, which is the only half a host can reach. */
#define KEEB_DISPLAY_INFO_F_PEER 0x02u

/** KEEB_T_DISPLAY header, then `count` keeb_widget entries, then the text
 * slots as KEEB_T_TEXT_SET records and the values as KEEB_T_VALUE_SET records.
 * Also the header of a KEEB_T_DISPLAY_SET payload (same layout, host -> board).
 */
struct KEEB_PACKED keeb_display_hdr {
	uint8_t count;  /* widgets that follow */
	uint8_t preset; /* preset the table was derived from */
	uint8_t flags;  /* KEEB_DISPLAY_F_* */
	uint8_t rsvd;
};

#define KEEB_DISPLAY_F_DIRTY 0x01u /* not yet saved to settings */
#define KEEB_DISPLAY_F_FIXED 0x02u /* reserved: the peer panel used to be fixed */

/** KEEB_T_WIDGET_SET: uint8_t index, then one keeb_widget. */
struct KEEB_PACKED keeb_widget_set {
	uint8_t index;
	uint8_t rsvd;
};

/** KEEB_T_TEXT_SET: header, then `len` bytes of UTF-8 (no NUL on the wire). */
struct KEEB_PACKED keeb_text_slot {
	uint8_t slot;
	uint8_t len;
};

/** KEEB_T_VALUE_SET: one number a host pushed into a slot. */
struct KEEB_PACKED keeb_value_slot {
	uint8_t slot;
	uint8_t rsvd;
	int16_t value;
};

/** KEEB_T_PRESET_SET / KEEB_T_DISPLAY_RESET payload: the preset id. A zero-length
 * payload means preset 0.
 */
struct KEEB_PACKED keeb_preset_set {
	uint8_t preset;
	uint8_t rsvd;
};

/** KEEB_T_PRESET_NAME: header, then `name_len` bytes of the preset's name. */
struct KEEB_PACKED keeb_preset_name {
	uint8_t preset;
	uint8_t name_len;
};

/** One cell of a dump (KEEB_T_CELLS). */
struct KEEB_PACKED keeb_cell {
	uint8_t layer;
	uint8_t flags; /* KEEB_CELL_F_* */
	uint16_t pos;  /* stock position, not the matrix position */
	uint16_t token;
	uint16_t rsvd;
	uint32_t param1;
	uint32_t param2;
};

/** KEEB_T_CELLS header (one layer per message). */
struct KEEB_PACKED keeb_cells_hdr {
	uint8_t layer;
	uint8_t flags;
	uint16_t count;
};

/** KEEB_T_CELLS_SET header, then `count` keeb_cell_set entries. */
struct KEEB_PACKED keeb_cells_set_hdr {
	uint8_t layer;
	uint8_t flags;
	uint16_t count;
};

/** One requested binding. `token` KEEB_TOKEN_NONE clears the cell. */
struct KEEB_PACKED keeb_cell_set {
	uint16_t pos;
	uint8_t flags;
	uint8_t rsvd;
	uint16_t token;
	uint16_t rsvd2;
	uint32_t param1;
	uint32_t param2;
};

/** KEEB_T_LAYERS header, then order[layer_count] ids, then names. */
struct KEEB_PACKED keeb_layers_hdr {
	uint16_t count;   /* slots in the image */
	uint16_t active;  /* highest active layer id, 0xffff if none */
	uint32_t state;   /* active bit per layer id */
	uint32_t locked;  /* locked bit per layer id */
	uint8_t rsvd;
	uint8_t name_max;
};

/** KEEB_T_TOKENS header: the first record of a token listing. */
struct KEEB_PACKED keeb_tokens_hdr {
	uint16_t next; /* index to continue from, 0xffff when complete */
	uint16_t count;
	uint32_t token_hash;
};

/** One token summary (KEEB_T_TOKENS), followed by name_len name bytes. */
struct KEEB_PACKED keeb_token_rec {
	uint16_t token;
	uint16_t rsvd;
	uint8_t name_len;
	uint8_t flags; /* KEEB_TOKEN_F_* */
};

#define KEEB_TOKEN_F_READY 0x01u /* the behavior driver exists in this build */

/** KEEB_T_TOKEN_PARAMS header: param metadata for one token, taken from ZMK's
 * own behavior metadata (CONFIG_ZMK_BEHAVIOR_METADATA), so the configurator
 * asks for exactly the params this behavior accepts.
 */
struct KEEB_PACKED keeb_token_params_hdr {
	uint16_t token;
	uint8_t param; /* 0 = param1, 1 = param2 */
	uint8_t count;
};

/** One accepted value / range of a param. */
struct KEEB_PACKED keeb_param_value {
	uint16_t token;
	uint8_t param;
	uint8_t type; /* mirrors behavior_parameter_metadata types */
	uint32_t a;   /* value, or range min */
	uint32_t b;   /* unused, or range max */
	uint8_t name_len;
	uint8_t set; /* metadata set index (macro behaviors use several) */
};

/* --------------------------------------------------------------------------
 * Settings payloads
 * --------------------------------------------------------------------------
 *
 * KEEB_T_SETTINGS / KEEB_T_SETTINGS_SET: runtime overrides of build values that
 * affect behaviour.  A field is written when the corresponding flag is set, so a
 * host can change one value without sending the others.
 *
 * The two timeouts and the two debounce timings act on the half that receives
 * them (each half sleeps on its own clock, scans its own matrix and drives its
 * own status LED), so the central relays them to the peripheral - see
 * settings/keeb_settings.c.  The hold-tap fields are central-only: only the
 * central resolves hold-taps.
 */

#define KEEB_SETTINGS_F_IDLE_TIMEOUT 0x0001u
#define KEEB_SETTINGS_F_SLEEP_TIMEOUT 0x0002u
#define KEEB_SETTINGS_F_DEBOUNCE_PRESS 0x0004u
#define KEEB_SETTINGS_F_DEBOUNCE_RELEASE 0x0008u
#define KEEB_SETTINGS_F_TAPPING_TERM 0x0010u
#define KEEB_SETTINGS_F_QUICK_TAP 0x0020u
#define KEEB_SETTINGS_F_PRIOR_IDLE 0x0040u
#define KEEB_SETTINGS_F_HOLD_TAP_FLAVOR 0x0080u
#define KEEB_SETTINGS_F_SLEEP_ALLOWED 0x0100u
#define KEEB_SETTINGS_F_BLANK_ON_IDLE 0x0200u
#define KEEB_SETTINGS_F_LED_BRIGHTNESS 0x0400u
#define KEEB_SETTINGS_F_LED_COLOR_RED 0x0800u
#define KEEB_SETTINGS_F_LED_COLOR_GREEN 0x1000u
#define KEEB_SETTINGS_F_LED_COLOR_BLUE 0x2000u
/* The whole per-layer color table below, written as one table. */
#define KEEB_SETTINGS_F_LED_LAYERS 0x4000u
#define KEEB_SETTINGS_F_ALL 0x7fffu

/* Values of the boolean settings, read when the matching flag above is set. */
#define KEEB_SETTINGS_B_SLEEP_ALLOWED 0x01u /* ZMK_SLEEP, off = never deep sleep */
#define KEEB_SETTINGS_B_BLANK_ON_IDLE 0x02u /* ZMK_DISPLAY_BLANK_ON_IDLE */
#define KEEB_SETTINGS_B_ALL 0x03u

/* hold_tap_flavor value meaning "no override": every hold-tap keeps its own
 * devicetree flavour.  For the three hold-tap timings, zero is the same idea. */
#define KEEB_SETTINGS_FLAVOR_AUTO 0xffu

/* How many layer colors the table carries.  A layer this build does not have
 * simply keeps an unused entry. */
#define KEEB_SETTINGS_LED_LAYER_MAX 8

/* --------------------------------------------------------------------------
 * Buzzer sound payloads
 * --------------------------------------------------------------------------
 *
 * A tune is a shape, not a set of absolute frequencies: each step's pitch is a
 * percentage of CONFIG_ZMK_BUZZER_TUNE_BASE_HZ, so re-tuning the vocabulary to
 * a different piezo is one build value rather than seven rewritten tables.
 *
 * A boot starts from the compiled-in shapes; KEEB_T_TUNE_SET rewrites RAM, and
 * only KEEB_T_SETTINGS_SAVE persists. KEEB_T_TUNE_PLAY is a preview: it makes
 * a sound and changes nothing, so it never dirties the page.
 */

#define KEEB_SOUND_TUNE_COUNT 7  /* enum zmk_buzzer_tune, random first */
#define KEEB_SOUND_STEPS_MAX 8   /* ZMK_BUZZER_STEPS_MAX */
#define KEEB_SOUND_EVENT_COUNT 5 /* enum keeb_sound_event */

/* Which events the firmware sounds on its own. The ids match
 * enum zmk_buzzer_event: the driver resolves event -> tune through a RAM map
 * this namespace edits, which is what lets a host change "what a layer change
 * sounds like" without a rebuild. */
enum keeb_sound_event {
	KEEB_SND_LAYER_ON = 0,
	KEEB_SND_LAYER_OFF = 1,
	KEEB_SND_UPDATE_OK = 2,
	KEEB_SND_UPDATE_FAIL = 3,
	KEEB_SND_WAKE = 4
};

/** One tune step. Range is checked by the firmware, not assumed: pitch 50-400 %,
 * on-time 10-1000 ms, gap 0-1000 ms (a gap on the last step is not played). */
struct KEEB_PACKED keeb_tune_step {
	uint16_t pitch_pct;
	uint16_t on_ms;
	uint16_t gap_ms;
};

/** KEEB_T_TUNE / KEEB_T_TUNE_SET header, then `count` keeb_tune_step entries. */
struct KEEB_PACKED keeb_tune_hdr {
	uint8_t tune;  /* enum zmk_buzzer_tune */
	uint8_t count; /* 1..KEEB_SOUND_STEPS_MAX */
	uint16_t rsvd;
};

/** KEEB_T_SOUND_MAP / KEEB_T_SOUND_MAP_SET: one event's tune. */
struct KEEB_PACKED keeb_sound_map {
	uint8_t event; /* enum keeb_sound_event */
	uint8_t tune;  /* enum zmk_buzzer_tune */
};

/** KEEB_T_TUNE_PLAY: play one tune now (preview), change nothing. */
struct KEEB_PACKED keeb_sound_play {
	uint8_t tune;
	uint8_t rsvd;
};

struct KEEB_PACKED keeb_settings {
	uint32_t idle_timeout_ms;     /* CONFIG_ZMK_IDLE_TIMEOUT */
	uint32_t sleep_timeout_ms;    /* CONFIG_ZMK_IDLE_SLEEP_TIMEOUT */
	uint32_t debounce_press_ms;   /* kscan debounce-press-ms, this half's matrix */
	uint32_t debounce_release_ms; /* kscan debounce-release-ms, this half's matrix */
	int32_t tapping_term_ms;      /* hold-tap tapping-term-ms, 0 = devicetree */
	int32_t quick_tap_ms;         /* hold-tap quick-tap-ms, 0 = devicetree, -1 = off */
	int32_t prior_idle_ms;        /* hold-tap require-prior-idle-ms, 0 = devicetree */
	uint32_t led_brightness_percent; /* status LED: every lit signal, 0..100 */
	uint32_t led_color_red;     /* status LED color, 0x00RRGGBB (battery error) */
	uint32_t led_color_green;   /* status LED color, 0x00RRGGBB (profile connected) */
	uint32_t led_color_blue;    /* status LED color, 0x00RRGGBB (advertising) */
	/*
	 * Per-layer status LED colors, 0x00RRGGBB, 0 = LED off while that layer is
	 * active.  Indexed by keymap layer index and PINNED to it: moving a layer
	 * in the keymap does not move its color.  These are the layer colors only:
	 * the three colors above stay the BLE/status signals and are not touched
	 * by a layer change.
	 */
	uint32_t led_layer_colors[KEEB_SETTINGS_LED_LAYER_MAX];
	uint16_t flags;               /* KEEB_SETTINGS_F_*: which fields this message carries */
	uint8_t booleans;             /* KEEB_SETTINGS_B_* values */
	uint8_t hold_tap_flavor;      /* 0..3, or KEEB_SETTINGS_FLAVOR_AUTO */
};

/* --------------------------------------------------------------------------
 * Payload size asserts - see keeb_tlv_wire.h for why.
 * -------------------------------------------------------------------------- */

/* Session. */
_Static_assert(sizeof(struct keeb_info) == 20, "struct keeb_info is no longer 20 bytes on the wire");
_Static_assert(sizeof(struct keeb_ack) == 10, "struct keeb_ack is no longer 10 bytes on the wire");
_Static_assert(sizeof(struct keeb_notify) == 4, "struct keeb_notify is no longer 4 bytes on the wire");

/* Keymap. */
_Static_assert(sizeof(struct keeb_cell) == 16, "struct keeb_cell is no longer 16 bytes on the wire");
_Static_assert(sizeof(struct keeb_cells_hdr) == 4, "struct keeb_cells_hdr is no longer 4 bytes on the wire");
_Static_assert(sizeof(struct keeb_cells_set_hdr) == 4, "struct keeb_cells_set_hdr is no longer 4 bytes on the wire");
_Static_assert(sizeof(struct keeb_cell_set) == 16, "struct keeb_cell_set is no longer 16 bytes on the wire");
_Static_assert(sizeof(struct keeb_layers_hdr) == 14, "struct keeb_layers_hdr is no longer 14 bytes on the wire");
_Static_assert(sizeof(struct keeb_tokens_hdr) == 8, "struct keeb_tokens_hdr is no longer 8 bytes on the wire");
_Static_assert(sizeof(struct keeb_token_rec) == 6, "struct keeb_token_rec is no longer 6 bytes on the wire");
_Static_assert(sizeof(struct keeb_token_params_hdr) == 4, "struct keeb_token_params_hdr is no longer 4 bytes on the wire");
_Static_assert(sizeof(struct keeb_param_value) == 14, "struct keeb_param_value is no longer 14 bytes on the wire");

/* Display. */
_Static_assert(sizeof(struct keeb_display_info) == 21, "struct keeb_display_info is no longer 21 bytes on the wire");
_Static_assert(sizeof(struct keeb_display_hdr) == 4, "struct keeb_display_hdr is no longer 4 bytes on the wire");
_Static_assert(sizeof(struct keeb_widget) == 7, "struct keeb_widget is no longer 7 bytes on the wire");
_Static_assert(sizeof(struct keeb_widget_set) == 2, "struct keeb_widget_set is no longer 2 bytes on the wire");
_Static_assert(sizeof(struct keeb_text_slot) == 2, "struct keeb_text_slot is no longer 2 bytes on the wire");
_Static_assert(sizeof(struct keeb_value_slot) == 4, "struct keeb_value_slot is no longer 4 bytes on the wire");
_Static_assert(sizeof(struct keeb_preset_set) == 2, "struct keeb_preset_set is no longer 2 bytes on the wire");
_Static_assert(sizeof(struct keeb_preset_name) == 2, "struct keeb_preset_name is no longer 2 bytes on the wire");

/* Settings. */
_Static_assert(sizeof(struct keeb_settings) == 80, "struct keeb_settings is no longer 80 bytes on the wire");

/* Buzzer sounds. The tune ids are enum zmk_buzzer_tune and the event ids are
 * enum zmk_buzzer_event / enum keeb_sound_event - the driver's order IS the
 * wire order, and settings/keeb_sound.c asserts the two counts match. */
_Static_assert(sizeof(struct keeb_tune_step) == 6, "struct keeb_tune_step is no longer 6 bytes on the wire");
_Static_assert(sizeof(struct keeb_tune_hdr) == 4, "struct keeb_tune_hdr is no longer 4 bytes on the wire");
_Static_assert(sizeof(struct keeb_sound_map) == 2, "struct keeb_sound_map is no longer 2 bytes on the wire");
_Static_assert(sizeof(struct keeb_sound_play) == 2, "struct keeb_sound_play is no longer 2 bytes on the wire");

#endif /* KEEB_MODULE_PROTO_TLV_RECORDS_H */
