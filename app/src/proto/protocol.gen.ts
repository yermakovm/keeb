/*
 * GENERATED FILE — do not edit.
 *
 * Copyright (c) 2025 The keeb keyboard authors
 * SPDX-License-Identifier: MIT
 *
 * KEEB TLV protocol constants, generated from the firmware's own headers:
 *   keeb-module/proto/keeb_tlv_wire.h
 *   keeb-module/proto/keeb_tlv_records.h
 *   keeb-module/proto/keeb_tlv.h
 *
 * Re-run with: npm run gen
 *
 * Every number is a #define or enum member in those headers, evaluated with the
 * same arithmetic the preprocessor uses (KEEB_TLV_TYPE(ns, op) and friends), and
 * every struct size is re-derived from its field list and checked against the
 * _Static_assert the firmware compiles. A disagreement fails this script.
 *
 * Not generated, on purpose: the BLE transport numbers (the app's KEEB_BLE_*
 * mirror keeb_ble.c, which derives them from Zephyr's Kconfig MTU rather than
 * from a #define), the vendor UUID strings, and the app-only helpers.
 */

export const GENERATED_PROTOCOL_FROM = [
  "keeb-module/proto/keeb_tlv_wire.h",
  "keeb-module/proto/keeb_tlv_records.h",
  "keeb-module/proto/keeb_tlv.h"
]

export const KEEB_TLV_MAGIC = 0x4b45

export const KEEB_TLV_VERSION = 1

export const KEEB_TLV_MSG_MAX = 1024

export const KEEB_PKT_HDR_SIZE = 16

export const KEEB_TLV_FRAG_MAX = 128

export const KEEB_TLV_FRAG_MIN = 20

export const KEEB_PKT_F_REPLY = 0x01

export const KEEB_PKT_F_NOTIFY = 0x02

export const KEEB_PKT_F_FIRST = 0x04

/** reserved positions are pinned */
export const KEEB_INFO_F_RESERVED_FROZEN = 1

/** layer reorder/add/remove live */
export const KEEB_INFO_F_REORDERING = 2

/** changes survive reboot */
export const KEEB_INFO_F_PERSISTENT = 4

/** DISPLAY namespace is compiled in */
export const KEEB_INFO_F_DISPLAY = 8

export const KEEB_NS_SYS = 0

export const KEEB_NS_KEYMAP = 1

/** status-screen widget table + its readouts */
export const KEEB_NS_DISPLAY = 2

/** unused yet: sleep timeout and friends */
export const KEEB_NS_SETTINGS = 3

/** unused yet: chunked artwork upload */
export const KEEB_NS_IMAGE = 4

export const KEEB_T_PING = 1

export const KEEB_T_INFO = 2

export const KEEB_T_ACK = 3

export const KEEB_T_NOTIFY = 4

export const KEEB_T_TOKENS = 5

export const KEEB_T_TOKEN_PARAMS = 6

export const KEEB_T_CELLS_GET = 4097

export const KEEB_T_CELLS = 4098

export const KEEB_T_CELLS_SET = 4099

export const KEEB_T_SAVE = 4100

export const KEEB_T_DISCARD = 4101

export const KEEB_T_RESET = 4102

export const KEEB_T_LAYERS_GET = 4103

export const KEEB_T_LAYERS = 4104

export const KEEB_T_LAYER_NAME_SET = 4105

export const KEEB_T_LAYER_MOVE = 4106

export const KEEB_T_LAYER_ADD = 4107

export const KEEB_T_LAYER_REMOVE = 4108

export const KEEB_T_LAYER_RESTORE = 4109

export const KEEB_T_APPLY_COMMIT = 4110

export const KEEB_T_APPLY_CANCEL = 4111

export const KEEB_T_TEST_SET = 4112

export const KEEB_T_DISPLAY_INFO = 8193

export const KEEB_T_DISPLAY_GET = 8194

export const KEEB_T_DISPLAY = 8195

export const KEEB_T_DISPLAY_SET = 8196

export const KEEB_T_WIDGET_SET = 8197

export const KEEB_T_TEXT_SET = 8198

export const KEEB_T_VALUE_SET = 8199

export const KEEB_T_PRESET_SET = 8200

export const KEEB_T_DISPLAY_SAVE = 8201

export const KEEB_T_DISPLAY_DISCARD = 8202

export const KEEB_T_DISPLAY_RESET = 8203

export const KEEB_T_DISPLAY_BLANK = 8204

export const KEEB_T_PRESET_NAME = 8205

export const KEEB_ERR_NONE = 0

export const KEEB_ERR_BAD_MAGIC = 1

export const KEEB_ERR_BAD_VERSION = 2

export const KEEB_ERR_BAD_CRC = 3

export const KEEB_ERR_BAD_LEN = 4

export const KEEB_ERR_BAD_SEQ = 5

export const KEEB_ERR_TOO_BIG = 6

export const KEEB_ERR_UNKNOWN_TYPE = 7

export const KEEB_ERR_OUT_OF_RANGE = 8

export const KEEB_ERR_UNKNOWN_TOKEN = 9

export const KEEB_ERR_RESERVED_POSITION = 10

export const KEEB_ERR_BEHAVIOR = 11

export const KEEB_ERR_STORAGE = 12

export const KEEB_ERR_NO_SPACE = 13

export const KEEB_ERR_NOT_SUPPORTED = 14

export const KEEB_ERR_BUSY = 15

/** kind/source unknown, or geometry outside the panel */
export const KEEB_ERR_BAD_WIDGET = 16

/** position has no binding yet */
export const KEEB_TOKEN_NONE = 65535

/** binding the token table does not cover */
export const KEEB_TOKEN_UNKNOWN = 65534

/** ZMK's split payload limit for these names */
export const KEEB_TOKEN_NAME_MAX = 16

/** firmware-owned position, writes refused */
export const KEEB_CELL_F_RESERVED = 1

/** payload: uint32_t layer state bitmap */
export const KEEB_EV_LAYER_STATE = 1

/** payload: uint8_t layer, uint16_t count */
export const KEEB_EV_CELLS_SET = 2

/** payload: none */
export const KEEB_EV_SAVED = 3

/** payload: none (revert chord too) */
export const KEEB_EV_DISCARDED = 4

/** payload: uint8_t layer id */
export const KEEB_EV_LAYER_CHANGED = 5

/** payload: uint8_t count, uint8_t flags */
export const KEEB_EV_DISPLAY_SET = 6

/** payload: uint8_t slot */
export const KEEB_EV_TEXT_SET = 7

/** payload: none */
export const KEEB_EV_DISPLAY_SAVED = 8

/** payload: uint8_t pos, uint8_t pressed, uint8_t layer */
export const KEEB_EV_KEY = 9

/** KEEB_WID_RECT: fill with paper instead of ink */
export const KEEB_RECT_PAPER = 1

/** 6 x 3, gap 2  - fits 10 pips in 152 px */
export const KEEB_PIPS_SMALL = 0

/** 7 x 4, gap 3  - the portrait panel */
export const KEEB_PIPS_LARGE = 1

/** 5 x 3, gap 2 */
export const KEEB_PIPS_TINY = 2

/** centre inside the box, clip what overflows */
export const KEEB_ART_CENTRE = 0

/** align to the bottom edge of the box */
export const KEEB_ART_BOTTOM = 1

export const KEEB_DEV_NONE = 0

export const KEEB_DEV_USB = 128

export const KEEB_DISPLAY_INFO_F_ART = 1

/** not yet saved to settings */
export const KEEB_DISPLAY_F_DIRTY = 1

/** read-only table (peripheral half) */
export const KEEB_DISPLAY_F_FIXED = 2

/** the behavior driver exists in this build */
export const KEEB_TOKEN_F_READY = 1

export const KEEB_CRC32_START = 4294967295

export const KEEB_TLV_RX_INIT = 0

/** TX pool empty: retry this fragment later, unchanged */
export const KEEB_TX_BUSY = 1

/** peer MTU smaller than advertised: shrink, retry */
export const KEEB_TX_MTU = 2

/** unrecoverable: the message is dropped */
export const KEEB_TX_FAIL = 3

export const KEEB_STATUS_OK = 0

export const KEEB_STATUS_ERR = 1

export const KEEB_WID_NONE = 0

export const KEEB_WID_FRAME = 1

export const KEEB_WID_RECT = 2

export const KEEB_WID_RULE = 3

export const KEEB_WID_TEXT = 4

export const KEEB_WID_BAR = 5

export const KEEB_WID_BATTERY = 6

export const KEEB_WID_PIPS = 7

export const KEEB_WID_BOLT = 8

export const KEEB_WID_ART = 9

export const KEEB_WID_COUNT = 10

export const KEEB_SRC_NONE = 0

export const KEEB_SRC_LAYER_INDEX = 1

export const KEEB_SRC_LAYER_NAME = 2

export const KEEB_SRC_LAYER_POS = 3

export const KEEB_SRC_LAYER_PIPS = 4

export const KEEB_SRC_LAYER_ART = 5

export const KEEB_SRC_BATT_LEFT = 6

export const KEEB_SRC_BATT_LEFT_PCT = 7

export const KEEB_SRC_BATT_RIGHT = 8

export const KEEB_SRC_BATT_RIGHT_PCT = 9

export const KEEB_SRC_LINK = 10

export const KEEB_SRC_LINK_SHORT = 11

export const KEEB_SRC_HOST = 12

export const KEEB_SRC_CHARGING = 13

export const KEEB_SRC_DEVICE_ID = 14

export const KEEB_SRC_DEVICE_NAME = 15

export const KEEB_SRC_TEXT_BASE = 0x20

export const KEEB_SRC_VALUE_BASE = 0x40

/* Wire struct layouts: sizes the headers assert, and the offset of every
 * field, so a decoder never hardcodes where a field sits. */

/** struct keeb_pkt_hdr — the packed field widths in order, and where each field sits. */
export const KEEB_PKT_HDR_FIELDS: number[] = [2, 1, 1, 2, 2, 2, 2, 4]
export const KEEB_PKT_HDR_OFFSETS: Record<string, number> = {
  "magic": 0,
  "version": 2,
  "flags": 3,
  "msg_id": 4,
  "frag_off": 6,
  "frag_len": 8,
  "msg_len": 10,
  "crc": 12
}

/** sizeof(struct keeb_tlv_rec) — asserted in the header */
export const KEEB_TLV_REC_SIZE = 4

/** struct keeb_tlv_rec — the packed field widths in order, and where each field sits. */
export const KEEB_TLV_REC_FIELDS: number[] = [2, 2]
export const KEEB_TLV_REC_OFFSETS: Record<string, number> = {
  "type": 0,
  "len": 2
}

/** sizeof(struct keeb_info) — asserted in the header */
export const KEEB_INFO_SIZE = 20

/** struct keeb_info — the packed field widths in order, and where each field sits. */
export const KEEB_INFO_FIELDS: number[] = [2, 2, 2, 2, 2, 2, 4, 4]
export const KEEB_INFO_OFFSETS: Record<string, number> = {
  "proto": 0,
  "fw_version": 2,
  "layer_count": 4,
  "key_count": 6,
  "name_max": 8,
  "token_count": 10,
  "token_hash": 12,
  "flags": 16
}

/** sizeof(struct keeb_ack) — asserted in the header */
export const KEEB_ACK_SIZE = 10

/** struct keeb_ack — the packed field widths in order, and where each field sits. */
export const KEEB_ACK_FIELDS: number[] = [2, 1, 1, 2, 4]
export const KEEB_ACK_OFFSETS: Record<string, number> = {
  "msg_id": 0,
  "status": 2,
  "err_code": 3,
  "detail": 4,
  "extra": 6
}

/** sizeof(struct keeb_notify) — asserted in the header */
export const KEEB_NOTIFY_SIZE = 4

/** struct keeb_notify — the packed field widths in order, and where each field sits. */
export const KEEB_NOTIFY_FIELDS: number[] = [2, 2]
export const KEEB_NOTIFY_OFFSETS: Record<string, number> = {
  "event": 0,
  "seq": 2
}

/** sizeof(struct keeb_widget) — asserted in the header */
export const KEEB_WIDGET_SIZE = 7

/** struct keeb_widget — the packed field widths in order, and where each field sits. */
export const KEEB_WIDGET_FIELDS: number[] = [1, 1, 1, 1, 1, 1, 1]
export const KEEB_WIDGET_OFFSETS: Record<string, number> = {
  "kind": 0,
  "source": 1,
  "x": 2,
  "y": 3,
  "w": 4,
  "h": 5,
  "style": 6
}

/** sizeof(struct keeb_display_info) — asserted in the header */
export const KEEB_DISPLAY_INFO_SIZE = 21

/** struct keeb_display_info — the packed field widths in order, and where each field sits. */
export const KEEB_DISPLAY_INFO_FIELDS: number[] = [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 1, 1, 1]
export const KEEB_DISPLAY_INFO_OFFSETS: Record<string, number> = {
  "editable": 0,
  "preset_count": 1,
  "widget_max": 2,
  "text_slots": 3,
  "text_max": 4,
  "value_slots": 5,
  "kind_max": 6,
  "source_max": 7,
  "logical_w": 8,
  "logical_h": 10,
  "panel_w": 12,
  "panel_h": 14,
  "rotation": 16,
  "widget_size": 18,
  "flags": 19,
  "layers": 20
}

/** sizeof(struct keeb_display_hdr) — asserted in the header */
export const KEEB_DISPLAY_HDR_SIZE = 4

/** struct keeb_display_hdr — the packed field widths in order, and where each field sits. */
export const KEEB_DISPLAY_HDR_FIELDS: number[] = [1, 1, 1, 1]
export const KEEB_DISPLAY_HDR_OFFSETS: Record<string, number> = {
  "count": 0,
  "preset": 1,
  "flags": 2,
  "rsvd": 3
}

/** sizeof(struct keeb_widget_set) — asserted in the header */
export const KEEB_WIDGET_SET_SIZE = 2

/** struct keeb_widget_set — the packed field widths in order, and where each field sits. */
export const KEEB_WIDGET_SET_FIELDS: number[] = [1, 1]
export const KEEB_WIDGET_SET_OFFSETS: Record<string, number> = {
  "index": 0,
  "rsvd": 1
}

/** sizeof(struct keeb_text_slot) — asserted in the header */
export const KEEB_TEXT_SLOT_SIZE = 2

/** struct keeb_text_slot — the packed field widths in order, and where each field sits. */
export const KEEB_TEXT_SLOT_FIELDS: number[] = [1, 1]
export const KEEB_TEXT_SLOT_OFFSETS: Record<string, number> = {
  "slot": 0,
  "len": 1
}

/** sizeof(struct keeb_value_slot) — asserted in the header */
export const KEEB_VALUE_SLOT_SIZE = 4

/** struct keeb_value_slot — the packed field widths in order, and where each field sits. */
export const KEEB_VALUE_SLOT_FIELDS: number[] = [1, 1, 2]
export const KEEB_VALUE_SLOT_OFFSETS: Record<string, number> = {
  "slot": 0,
  "rsvd": 1,
  "value": 2
}

/** sizeof(struct keeb_preset_set) — asserted in the header */
export const KEEB_PRESET_SET_SIZE = 2

/** struct keeb_preset_set — the packed field widths in order, and where each field sits. */
export const KEEB_PRESET_SET_FIELDS: number[] = [1, 1]
export const KEEB_PRESET_SET_OFFSETS: Record<string, number> = {
  "preset": 0,
  "rsvd": 1
}

/** sizeof(struct keeb_preset_name) — asserted in the header */
export const KEEB_PRESET_NAME_SIZE = 2

/** struct keeb_preset_name — the packed field widths in order, and where each field sits. */
export const KEEB_PRESET_NAME_FIELDS: number[] = [1, 1]
export const KEEB_PRESET_NAME_OFFSETS: Record<string, number> = {
  "preset": 0,
  "name_len": 1
}

/** sizeof(struct keeb_cell) — asserted in the header */
export const KEEB_CELL_SIZE = 16

/** struct keeb_cell — the packed field widths in order, and where each field sits. */
export const KEEB_CELL_FIELDS: number[] = [1, 1, 2, 2, 2, 4, 4]
export const KEEB_CELL_OFFSETS: Record<string, number> = {
  "layer": 0,
  "flags": 1,
  "pos": 2,
  "token": 4,
  "rsvd": 6,
  "param1": 8,
  "param2": 12
}

/** sizeof(struct keeb_cells_hdr) — asserted in the header */
export const KEEB_CELLS_HDR_SIZE = 4

/** struct keeb_cells_hdr — the packed field widths in order, and where each field sits. */
export const KEEB_CELLS_HDR_FIELDS: number[] = [1, 1, 2]
export const KEEB_CELLS_HDR_OFFSETS: Record<string, number> = {
  "layer": 0,
  "flags": 1,
  "count": 2
}

/** sizeof(struct keeb_cells_set_hdr) — asserted in the header */
export const KEEB_CELLS_SET_HDR_SIZE = 4

/** struct keeb_cells_set_hdr — the packed field widths in order, and where each field sits. */
export const KEEB_CELLS_SET_HDR_FIELDS: number[] = [1, 1, 2]
export const KEEB_CELLS_SET_HDR_OFFSETS: Record<string, number> = {
  "layer": 0,
  "flags": 1,
  "count": 2
}

/** sizeof(struct keeb_cell_set) — asserted in the header */
export const KEEB_CELL_SET_SIZE = 16

/** struct keeb_cell_set — the packed field widths in order, and where each field sits. */
export const KEEB_CELL_SET_FIELDS: number[] = [2, 1, 1, 2, 2, 4, 4]
export const KEEB_CELL_SET_OFFSETS: Record<string, number> = {
  "pos": 0,
  "flags": 2,
  "rsvd": 3,
  "token": 4,
  "rsvd2": 6,
  "param1": 8,
  "param2": 12
}

/** sizeof(struct keeb_layers_hdr) — asserted in the header */
export const KEEB_LAYERS_HDR_SIZE = 14

/** struct keeb_layers_hdr — the packed field widths in order, and where each field sits. */
export const KEEB_LAYERS_HDR_FIELDS: number[] = [2, 2, 4, 4, 1, 1]
export const KEEB_LAYERS_HDR_OFFSETS: Record<string, number> = {
  "count": 0,
  "active": 2,
  "state": 4,
  "locked": 8,
  "rsvd": 12,
  "name_max": 13
}

/** sizeof(struct keeb_tokens_hdr) — asserted in the header */
export const KEEB_TOKENS_HDR_SIZE = 8

/** struct keeb_tokens_hdr — the packed field widths in order, and where each field sits. */
export const KEEB_TOKENS_HDR_FIELDS: number[] = [2, 2, 4]
export const KEEB_TOKENS_HDR_OFFSETS: Record<string, number> = {
  "next": 0,
  "count": 2,
  "token_hash": 4
}

/** sizeof(struct keeb_token_rec) — asserted in the header */
export const KEEB_TOKEN_REC_SIZE = 6

/** struct keeb_token_rec — the packed field widths in order, and where each field sits. */
export const KEEB_TOKEN_REC_FIELDS: number[] = [2, 2, 1, 1]
export const KEEB_TOKEN_REC_OFFSETS: Record<string, number> = {
  "token": 0,
  "rsvd": 2,
  "name_len": 4,
  "flags": 5
}

/** sizeof(struct keeb_token_params_hdr) — asserted in the header */
export const KEEB_TOKEN_PARAMS_HDR_SIZE = 4

/** struct keeb_token_params_hdr — the packed field widths in order, and where each field sits. */
export const KEEB_TOKEN_PARAMS_HDR_FIELDS: number[] = [2, 1, 1]
export const KEEB_TOKEN_PARAMS_HDR_OFFSETS: Record<string, number> = {
  "token": 0,
  "param": 2,
  "count": 3
}

/** sizeof(struct keeb_param_value) — asserted in the header */
export const KEEB_PARAM_VALUE_SIZE = 14

/** struct keeb_param_value — the packed field widths in order, and where each field sits. */
export const KEEB_PARAM_VALUE_FIELDS: number[] = [2, 1, 1, 4, 4, 1, 1]
export const KEEB_PARAM_VALUE_OFFSETS: Record<string, number> = {
  "token": 0,
  "param": 2,
  "type": 3,
  "a": 4,
  "b": 8,
  "name_len": 12,
  "set": 13
}

