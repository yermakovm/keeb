/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * KEEB TLV protocol constants — a 1:1 mirror of keeb-module/proto/keeb_tlv.h.
 *
 * These values are the contract. If a number here and the number in the
 * firmware disagree, the keyboard and the configurator are not speaking the
 * same protocol, so this file has exactly one source of truth: the header.
 * Names are kept identical to the C names on purpose (grep across both sides).
 */

/** Streaming CRC start state (keeb_tlv.h KEEB_CRC32_START). */
export const KEEB_CRC32_START = 0xffffffff

/** "KE" — distinguishes a KEEB packet from any other stream bytes. */
export const KEEB_TLV_MAGIC = 0x4b45
export const KEEB_TLV_VERSION = 1

/** Longest message in either direction (keeb_tlv.h: sized for a 60-cell layer). */
export const KEEB_TLV_MSG_MAX = 1024

export const KEEB_PKT_HDR_SIZE = 16

/** Largest fragment payload a sender starts with. */
export const KEEB_TLV_FRAG_MAX = 128

/** Smallest fragment payload the sender ever shrinks to (keeb_tlv.h
 * KEEB_TLV_FRAG_MIN). A peer whose ATT MTU cannot carry
 * KEEB_PKT_HDR_SIZE + this + KEEB_ATT_OVERHEAD cannot run the protocol at all;
 * both sides report that instead of halving forever.
 */
export const KEEB_TLV_FRAG_MIN = 20

/** Zephyr's ATT/notification budget on the keyboard (CONFIG_BT_L2CAP_TX_MTU). */
export const KEEB_BLE_ATT_MTU = 65

/** ATT bytes around a GATT payload: opcode + attribute handle. */
export const KEEB_ATT_OVERHEAD = 3

/** Fragment payload a BLE fragment can carry. The ATT PDU holds the opcode, the
 * handle and the *whole* KEEB packet - the 16 byte header is part of the
 * notification payload, not overhead the transport can ignore. Mirrors
 * KEEB_BLE_MAX_FRAG in keeb-module/transport/keeb_ble.c.
 */
export const KEEB_BLE_FRAG_PAYLOAD = KEEB_BLE_ATT_MTU - KEEB_ATT_OVERHEAD - KEEB_PKT_HDR_SIZE

export const KEEB_PKT_F_REPLY = 0x01
export const KEEB_PKT_F_NOTIFY = 0x02
export const KEEB_PKT_F_FIRST = 0x04

/* keeb_info.flags */
export const KEEB_INFO_F_RESERVED_FROZEN = 0x00000001
export const KEEB_INFO_F_REORDERING = 0x00000002
export const KEEB_INFO_F_PERSISTENT = 0x00000004
export const KEEB_INFO_F_DISPLAY = 0x00000008

/* Namespaces: type = (namespace << 12) | op. */
export const KEEB_NS_SYS = 0x0
export const KEEB_NS_KEYMAP = 0x1
export const KEEB_NS_DISPLAY = 0x2
export const KEEB_NS_SETTINGS = 0x3
export const KEEB_NS_IMAGE = 0x4

export const KEEB_TLV_TYPE = (ns: number, op: number): number => ((ns << 12) | op) & 0xffff

/* SYS */
export const KEEB_T_PING = KEEB_TLV_TYPE(KEEB_NS_SYS, 0x01)
export const KEEB_T_INFO = KEEB_TLV_TYPE(KEEB_NS_SYS, 0x02)
export const KEEB_T_ACK = KEEB_TLV_TYPE(KEEB_NS_SYS, 0x03)
export const KEEB_T_NOTIFY = KEEB_TLV_TYPE(KEEB_NS_SYS, 0x04)
export const KEEB_T_TOKENS = KEEB_TLV_TYPE(KEEB_NS_SYS, 0x05)
export const KEEB_T_TOKEN_PARAMS = KEEB_TLV_TYPE(KEEB_NS_SYS, 0x06)

/* KEYMAP */
export const KEEB_T_CELLS_GET = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x01)
export const KEEB_T_CELLS = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x02)
export const KEEB_T_CELLS_SET = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x03)
export const KEEB_T_SAVE = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x04)
export const KEEB_T_DISCARD = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x05)
export const KEEB_T_RESET = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x06)
export const KEEB_T_LAYERS_GET = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x07)
export const KEEB_T_LAYERS = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x08)
export const KEEB_T_LAYER_NAME_SET = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x09)
export const KEEB_T_LAYER_MOVE = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x0a)
export const KEEB_T_LAYER_ADD = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x0b)
export const KEEB_T_LAYER_REMOVE = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x0c)
export const KEEB_T_LAYER_RESTORE = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x0d)
/** Reserved for the staged-apply phase; named so the host never invents one. */
export const KEEB_T_APPLY_COMMIT = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x0e)
export const KEEB_T_APPLY_CANCEL = KEEB_TLV_TYPE(KEEB_NS_KEYMAP, 0x0f)

/* DISPLAY — the status screen's widget table. The firmware keeps a bounded
 * table of drawing primitives and paints it from a snapshot of ZMK's state, so
 * a widget chooses which readout appears where; it can never fake one. */
export const KEEB_T_DISPLAY_INFO = KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x01)
export const KEEB_T_DISPLAY_GET = KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x02)
export const KEEB_T_DISPLAY = KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x03)
export const KEEB_T_DISPLAY_SET = KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x04)
export const KEEB_T_WIDGET_SET = KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x05)
export const KEEB_T_TEXT_SET = KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x06)
export const KEEB_T_VALUE_SET = KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x07)
export const KEEB_T_PRESET_SET = KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x08)
export const KEEB_T_DISPLAY_SAVE = KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x09)
export const KEEB_T_DISPLAY_DISCARD = KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x0a)
export const KEEB_T_DISPLAY_RESET = KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x0b)
export const KEEB_T_DISPLAY_BLANK = KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x0c)
export const KEEB_T_PRESET_NAME = KEEB_TLV_TYPE(KEEB_NS_DISPLAY, 0x0d)

/** struct keeb_widget.kind — enum keeb_widget_kind. */
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

/** struct keeb_widget.source — enum keeb_widget_source. A source is a value the
 * firmware reads from ZMK; TEXT_BASE+i / VALUE_BASE+i are the slots a host may
 * write. */
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

export const KEEB_STYLE_FONT = (style: number): number => style & 0x3
export const KEEB_STYLE_ALIGN = (style: number): number => (style >> 2) & 0x3
export const KEEB_TEXT_STYLE = (font: number, align: number): number =>
  (font & 0x3) | ((align & 0x3) << 2)
/** KEEB_WID_RECT: fill with paper instead of ink. */
export const KEEB_RECT_PAPER = 1
/** KEEB_WID_PIPS pip geometry presets: (pip_w, pip_h, gap). */
export const KEEB_PIPS_SMALL = 0
export const KEEB_PIPS_LARGE = 1
export const KEEB_PIPS_TINY = 2
export const KEEB_PIPS_GEOMETRY: Record<number, { gap: number }> = {
  [KEEB_PIPS_SMALL]: { gap: 2 },
  [KEEB_PIPS_LARGE]: { gap: 3 },
  [KEEB_PIPS_TINY]: { gap: 2 },
}
/** KEEB_WID_ART fit. */
export const KEEB_ART_CENTRE = 0
export const KEEB_ART_BOTTOM = 1

/** KEEB_SRC_DEVICE_ID values the firmware reports. */
export const KEEB_DEV_NONE = 0
export const KEEB_DEV_USB = 0x80

/** keeb_display_hdr.flags */
export const KEEB_DISPLAY_F_DIRTY = 0x01
export const KEEB_DISPLAY_F_FIXED = 0x02
/** keeb_display_info.flags */
export const KEEB_DISPLAY_INFO_F_ART = 0x01
/** struct keeb_display_info.preset / a custom table */
export const KBEEB_PRESET_CUSTOM = 0xff

export const KEEB_STATUS_OK = 0
export const KEEB_STATUS_ERR = 1

/** keeb_ack.err_code (0 when OK). Mirrors KEEB_ERR_*. */
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
export const KEEB_ERR_BAD_WIDGET = 16

export const KEEB_ERR_TEXT: Record<number, string> = {
  [KEEB_ERR_NONE]: 'ok',
  [KEEB_ERR_BAD_MAGIC]: 'bad magic',
  [KEEB_ERR_BAD_VERSION]: 'protocol version mismatch',
  [KEEB_ERR_BAD_CRC]: 'crc mismatch',
  [KEEB_ERR_BAD_LEN]: 'bad length',
  [KEEB_ERR_BAD_SEQ]: 'out-of-order fragment',
  [KEEB_ERR_TOO_BIG]: 'message too big',
  [KEEB_ERR_UNKNOWN_TYPE]: 'unknown record type',
  [KEEB_ERR_OUT_OF_RANGE]: 'out of range',
  [KEEB_ERR_UNKNOWN_TOKEN]: 'unknown token',
  [KEEB_ERR_RESERVED_POSITION]: 'reserved position — the firmware refuses to rebind it',
  [KEEB_ERR_BEHAVIOR]: 'behavior rejected the binding',
  [KEEB_ERR_STORAGE]: 'settings storage failed',
  [KEEB_ERR_NO_SPACE]: 'no free layer slot',
  [KEEB_ERR_NOT_SUPPORTED]: 'not supported by this firmware',
  [KEEB_ERR_BUSY]: 'keyboard is busy — retry',
  [KEEB_ERR_BAD_WIDGET]: 'bad widget — unknown kind/source, or outside the panel',
}

/* Tokens */
export const KEEB_TOKEN_NONE = 0xffff
export const KEEB_TOKEN_UNKNOWN = 0xfffe
export const KEEB_TOKEN_NAME_MAX = 16

export const KEEB_CELL_F_RESERVED = 0x01
export const KEEB_TOKEN_F_READY = 0x01

/* Events (keeb_notify.event) */
export const KEEB_EV_LAYER_STATE = 0x0001
export const KEEB_EV_CELLS_SET = 0x0002
export const KEEB_EV_SAVED = 0x0003
export const KEEB_EV_DISCARDED = 0x0004
export const KEEB_EV_LAYER_CHANGED = 0x0005
export const KEEB_EV_DISPLAY_SET = 0x0006
export const KEEB_EV_TEXT_SET = 0x0007
export const KEEB_EV_DISPLAY_SAVED = 0x0008

/** Mirrors enum behavior_parameter_value_type in zmk/app/include/drivers/behavior.h. */
export const BEHAVIOR_PARAMETER_VALUE_TYPE_NIL = 0
export const BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE = 1
export const BEHAVIOR_PARAMETER_VALUE_TYPE_RANGE = 2
export const BEHAVIOR_PARAMETER_VALUE_TYPE_HID_USAGE = 3
export const BEHAVIOR_PARAMETER_VALUE_TYPE_LAYER_ID = 4

/** Results from a transport send other than success (keeb_tlv.h KEEB_TX_*). */
export const KEEB_TX_BUSY = 1
export const KEEB_TX_MTU = 2
export const KEEB_TX_FAIL = 3

/** Vendor GATT service (keeb-module/transport/keeb_ble.c KEEB_TLV_UUID). */
export const KEEB_SVC_UUID = '4b454542-0000-0001-9c41-4b4542544c56'
export const KEEB_CMD_UUID = '4b454542-0000-0002-9c41-4b4542544c56'
export const KEEB_EVT_UUID = '4b454542-0000-0003-9c41-4b4542544c56'

/** Bluetooth Human Interface Device service, 16-bit 0x1812.
 *
 * ZMK advertises it (zmk/app/src/ble.c `zmk_ble_ad`: GAP appearance 0x03C1
 * keyboard, flags, then UUID16_SOME = 0x1812 HID + 0x180F Battery), which is
 * why it looks like the obvious thing to filter a chooser by.
 *
 * It is not usable. 0x1812 is on the Web Bluetooth GATT blocklist
 * (github.com/WebBluetoothCG/registries/gatt_blocklist.txt: "Direct access to
 * HID devices like keyboards would let web pages become keyloggers"), and the
 * spec turns a blocklisted service in `filters` into a SecurityError. So "show
 * only HID devices" is not a narrowing this API allows - it is forbidden. The
 * chooser filters by the advertised name instead, which the generator takes
 * from CONFIG_ZMK_KEYBOARD_NAME (KEYBOARD_NAME in zmk.gen.ts).
 *
 * Kept as a comment with a constant so nobody re-adds it as a filter.
 */
export const KEEB_HID_SERVICE_UUID_BLOCKLISTED = '00001812-0000-1000-8000-00805f9b34fb'

/** Ask the user to hold these for REVERT_HOLD_MS when the channel is lost. */
export const LAYER_STATE_NONE = 0xffffffff
