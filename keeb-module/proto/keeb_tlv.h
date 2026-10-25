/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * KEEB TLV wire protocol - the config channel between the keyboard and the
 * configurator. Written from scratch; deliberately NOT ZMK Studio's protobuf
 * RPC (zmk/app/src/studio/) and independent of it, so the keyboard can be
 * configured without Studio being compiled in.
 *
 * This header is the protocol specification in code. It is host-compilable on
 * purpose (see tools/tlv_test.c) so the codec is tested without a keyboard:
 * it uses no Zephyr types, only stdint and packed structs.
 *
 * ---------------------------------------------------------------------------
 * Framing
 * ---------------------------------------------------------------------------
 * A *message* is a flat list of TLV records. Because the transport is BLE GATT
 * (and a notification can carry at most CONFIG_BT_L2CAP_TX_MTU = 65 bytes of
 * ATT PDU, i.e. 65 - 3 for the ATT opcode and handle - 16 for this packet
 * header = 46 bytes of message payload), a message is split into *packets*,
 * each one carrying a byte range of the message:
 *
 *   packet = keeb_pkt_hdr (16 B) | fragment payload (frag_len bytes)
 *   message = keeb_tlv_rec (4 B) | value, repeated  (<= KEEB_TLV_MSG_MAX)
 *
 * All integers are little-endian and the header is packed, so a byte copy of
 * the header is the wire image (see keeb_pkt_hdr_put/get, which do the byte
 * handling explicitly instead of punning a pointer at an unaligned buffer).
 *
 * Reassembly is offset-based, with one rule that keeps it trivial: fragments of
 * a message must arrive in order and the first one must set
 * KEEB_PKT_F_FIRST. A gap therefore resolves itself by the sender restarting
 * the message from offset 0, which the receiver can always honour because it
 * sees the FIRST flag. That matters because the command channel is
 * write-without-response, so a fragment can genuinely be lost.
 *
 * The CRC covers the whole message (all records), not the fragment: a damaged
 * fragment is caught at completion instead of per packet, which is what the
 * 62-byte notification budget leaves room for.
 *
 * ---------------------------------------------------------------------------
 * Records
 * ---------------------------------------------------------------------------
 * A record is `type` (16 bit) then `len` (16 bit) then `len` value bytes.
 * type = (namespace << 12) | op, so the namespaces below never collide and a
 * firmware that does not know a namespace can answer UNKNOWN_TYPE instead of
 * misreading it.
 *
 * Requests are answered by exactly one KEEB_T_ACK message (msg_id echoed), so
 * the configurator always knows whether a write landed. A message is applied
 * all-or-nothing: every record in it is validated before any of it is applied.
 */

#ifndef KEEB_MODULE_PROTO_TLV_H
#define KEEB_MODULE_PROTO_TLV_H

#include <stdbool.h>
#include <stdint.h>

/* --------------------------------------------------------------------------
 * Constants
 * -------------------------------------------------------------------------- */

/* Wire structs are packed: the byte layout *is* the protocol, and native
 * padding would silently differ between this header and the configurator's
 * DataView offsets. Written portably, because the same header is compiled by
 * Zephyr and by tools/tlv_test.c on the host.
 */
#define KEEB_PACKED __attribute__((packed))

/* "KE" - enough to tell a KEEB packet from any other stream bytes. */
#define KEEB_TLV_MAGIC 0x4b45
#define KEEB_TLV_VERSION 1

/* Longest message accepted in either direction. One layer of a 60-key board
 * is 60 * sizeof(keeb_cell) = 960 bytes, so this is sized for whole-layer
 * transfers plus a little headroom. Two buffers of this size (RX + TX) are the
 * main RAM cost of the engine.
 */
#define KEEB_TLV_MSG_MAX 1024

#define KEEB_PKT_HDR_SIZE 16

/* Largest fragment payload a sender uses. The BLE transport asks for less
 * (46 bytes: MTU 65 minus 3 for the ATT opcode and handle, minus the 16 byte
 * packet header the notification also has to carry), but the staging buffer is
 * sized from this constant so a transport with a bigger MTU never overruns it.
 */
#define KEEB_TLV_FRAG_MAX 128

/* Smallest fragment payload a sender falls back to when a peer cannot carry the
 * current one. Under this, stopping is better than halving: a link whose ATT
 * MTU cannot carry KEEB_PKT_HDR_SIZE + KEEB_TLV_FRAG_MIN + 3 cannot run this
 * protocol at all, and keeb_tlv_tx_pump says so instead of retrying forever.
 */
#define KEEB_TLV_FRAG_MIN 20

/* Bit 0: this is a reply/unsolicited message from the keyboard.
 * Bit 1: the message is an event notification (see KEEB_T_NOTIFY).
 * Bit 2: first fragment of a message; receiver resets its reassembly state.
 */
#define KEEB_PKT_F_REPLY 0x01
#define KEEB_PKT_F_NOTIFY 0x02
#define KEEB_PKT_F_FIRST 0x04

/* Protocol version handshake result / capability flags (keeb_info.flags). */
#define KEEB_INFO_F_RESERVED_FROZEN 0x00000001u /* reserved positions are pinned */
#define KEEB_INFO_F_REORDERING 0x00000002u      /* layer reorder/add/remove live */
#define KEEB_INFO_F_PERSISTENT 0x00000004u      /* changes survive reboot */
#define KEEB_INFO_F_DISPLAY 0x00000008u         /* DISPLAY namespace is compiled in */

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

/** Packet header. Exactly KEEB_PKT_HDR_SIZE bytes, packed little-endian:
 * magic(2) version(1) flags(1) msg_id(2) frag_off(2) frag_len(2) msg_len(2)
 * crc(4) = 16. There is no reserved field left on purpose - a header with
 * spare bytes invites the next revision to mean something by accident.
 */
struct KEEB_PACKED keeb_pkt_hdr {
	uint16_t magic;
	uint8_t version;
	uint8_t flags;
	uint16_t msg_id;   /* echoed by the reply of this message */
	uint16_t frag_off; /* byte offset of this fragment in the message */
	uint16_t frag_len; /* payload bytes that follow the header */
	uint16_t msg_len;  /* total reassembled message bytes */
	uint32_t crc;      /* CRC-32/IEEE of the whole message payload */
};

/** Record header. */
struct KEEB_PACKED keeb_tlv_rec {
	uint16_t type;
	uint16_t len;
};

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
	KEEB_WID_COUNT = 10
};

/* struct keeb_widget.source. A source is a value the firmware reads from ZMK at
 * draw time; KBEEB_SRC_TEXT_BASE+i and KBEEB_SRC_VALUE_BASE+i are the slots a
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
	                    * KBEEB_LAYER_COUNT: the configurator needs it to
	                    * check a pip row fits the panel before it writes */
};

/* This half links the layer artwork, so KEEB_WID_ART is accepted here. On the
 * central it is a Kconfig (CONFIG_KBEEB_UI_CENTRAL_ART): the artwork is ~54 KB
 * of A8 stencils, and a panel that only shows readouts should not pay for it. */
#define KEEB_DISPLAY_INFO_F_ART 0x01u

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
#define KEEB_DISPLAY_F_FIXED 0x02u /* read-only table (peripheral half) */

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
 * Codec API
 * -------------------------------------------------------------------------- */

/* CRC-32/IEEE (reflected, poly 0xedb88320, init/complement 0xffffffff).
 * Implemented here rather than via Zephyr's crc library so the host test and
 * the firmware run the identical code.
 */
uint32_t keeb_crc32(const uint8_t *data, uint16_t len);

/* Streaming form, for hashing something that is not one contiguous buffer
 * (the token table, for instance). The state passed around is the inverted
 * CRC, which is why no extra bytes are needed to start or finish: start with
 * KEEB_CRC32_START, update per chunk, then complement once.
 */
#define KEEB_CRC32_START 0xffffffffu

uint32_t keeb_crc32_update(uint32_t state, const uint8_t *data, uint16_t len);
uint32_t keeb_crc32_final(uint32_t state);

/* Packet header byte handling (no pointer punning: the fragment buffer is not
 * aligned for a 32-bit read on purpose).
 */
void keeb_pkt_hdr_put(const struct keeb_pkt_hdr *hdr, uint8_t *out);
void keeb_pkt_hdr_get(const uint8_t *in, struct keeb_pkt_hdr *out);

/** Building a message. Records are appended to a caller-owned buffer. */
struct keeb_tlv_msg {
	uint8_t *buf;
	uint16_t cap;
	uint16_t len;
};

void keeb_tlv_msg_init(struct keeb_tlv_msg *msg, uint8_t *buf, uint16_t cap);

/** Reserve a record of `value_len` payload bytes and return a pointer to that
 * payload. The record is counted immediately, so the caller can keep appending
 * records while the reserved bytes are still being filled - the ACK record
 * needs that, because its status is only known once the whole message has been
 * processed. Returns NULL when the buffer is full (nothing written).
 */
void *keeb_tlv_rec_add(struct keeb_tlv_msg *msg, uint16_t type, uint16_t value_len);

/** Convenience: add a record and copy a packed payload struct into it. */
int keeb_tlv_rec_add_struct(struct keeb_tlv_msg *msg, uint16_t type, const void *value,
			    uint16_t value_len);

/** Iterating a received message. keeb_tlv_iter_next returns 0 when it filled
 * the record, 1 when the message is exhausted, and -1 when the bytes are not
 * a valid record stream.
 */
struct keeb_tlv_iter {
	const uint8_t *p;
	uint16_t left;
};

void keeb_tlv_iter_init(struct keeb_tlv_iter *it, const uint8_t *msg, uint16_t len);
int keeb_tlv_iter_next(struct keeb_tlv_iter *it, uint16_t *type, const uint8_t **data,
		       uint16_t *data_len);

/** Receive reassembly. One instance per transport; feed it whole packets exactly
 * as the transport delivered them.
 */
struct keeb_tlv_rx {
	uint8_t buf[KEEB_TLV_MSG_MAX];
	uint16_t msg_len; /* 0 while idle (no message in progress) */
	uint16_t got;
	uint16_t msg_id;
	uint8_t flags;
};

#define KEEB_TLV_RX_INIT                                                                 \
	{ 0 }

/** Callback for a complete, CRC-verified message. The buffer is the
 * reassembly buffer and stays valid until the receiver accepts a new message,
 * which the caller must exploit instead of copying: the receiver holds the
 * message slot until the reply for it has been delivered.
 */
typedef void (*keeb_tlv_msg_cb)(void *user, uint16_t msg_id, uint8_t flags, const uint8_t *msg,
				uint16_t len);

/** Feed one packet.
 * Returns 0 when more fragments are needed, 1 when the message completed and
 * was handed to `cb`, and a negative KEEB_ERR_* reason when the packet was
 * rejected (the caller should report it, because a rejected packet means the
 * sender has to restart the message).
 */
int keeb_tlv_rx_feed(struct keeb_tlv_rx *rx, const uint8_t *pkt, uint16_t pkt_len,
		     keeb_tlv_msg_cb cb, void *user);

/* Results from struct keeb_tlv_tx_dev.send other than success. The codec
 * matches on these instead of on errno values, because Zephyr's and the host's
 * EBUSY/EMSGSIZE numbers are not the same, and the host test has to behave like
 * the firmware.
 */
#define KEEB_TX_BUSY 1 /* TX pool empty: retry this fragment later, unchanged */
#define KEEB_TX_MTU 2  /* peer MTU smaller than advertised: shrink, retry */
#define KEEB_TX_FAIL 3 /* unrecoverable: the message is dropped */

/** Sending a message: fragmentation with two failure modes that must be
 * handled, because BLE refuses to be ignored.
 *
 * KEEB_TX_BUSY means the Bluetooth TX pool is empty: the fragment is retried
 * later, unchanged. KEEB_TX_MTU means the negotiated MTU is smaller than the
 * transport advertised: the fragment size is halved (never below 20 bytes) and
 * the same offset is re-sent, which offset-based reassembly makes legal.
 */
struct keeb_tlv_tx_dev {
	/** Send one packet (header + fragment). Returns 0 or a KEEB_TX_* code. */
	int (*send)(void *user, const uint8_t *pkt, uint16_t pkt_len);
	void *user;
	uint16_t max_frag; /* payload bytes per fragment */
};

struct keeb_tlv_tx {
	const struct keeb_tlv_tx_dev *dev;
	uint8_t *pkt; /* caller's staging buffer, used by keeb_tlv_tx_pump */
	const uint8_t *msg;
	uint16_t msg_len;
	uint16_t off;
	uint16_t frag;
	uint16_t msg_id;
	uint8_t flags;
	uint8_t busy;
	int last_err;
	uint32_t crc; /* of the whole message, computed once at start */
};

/** Start sending. `pkt` is the caller's staging buffer (at least
 * KEEB_PKT_HDR_SIZE + KEEB_TLV_FRAG_MIN bytes) used to assemble header plus
 * fragment, because the transport wants them contiguous. Returns 1 when the
 * message is ready to pump, or a negative KEEB_ERR_* reason - including
 * KEEB_ERR_BUSY when a message is already in flight, which keeps the
 * single-configurator assumption honest instead of interleaving two streams
 * the receiver cannot untangle.
 */
int keeb_tlv_tx_start(struct keeb_tlv_tx *tx, const struct keeb_tlv_tx_dev *dev, uint8_t *pkt,
		      uint16_t pkt_cap, const uint8_t *msg, uint16_t msg_len, uint16_t msg_id,
		      uint8_t flags);

/** Send the next fragment. Returns 0 when the message is fully sent, 1 when
 * more fragments are pending, and -1 when the transport reported KEEB_TX_FAIL
 * and the message was abandoned. A message is never dropped for being slow or
 * for a small MTU: those cases keep the fragment and retry.
 */
int keeb_tlv_tx_pump(struct keeb_tlv_tx *tx);

#endif /* KEEB_MODULE_PROTO_TLV_H */
