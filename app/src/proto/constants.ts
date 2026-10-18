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

/** Smallest fragment the sender ever shrinks to: BLE min MTU (23) - 3. */
export const KEEB_TLV_FRAG_MIN = 20

export const KEEB_PKT_F_REPLY = 0x01
export const KEEB_PKT_F_NOTIFY = 0x02
export const KEEB_PKT_F_FIRST = 0x04

/* keeb_info.flags */
export const KEEB_INFO_F_RESERVED_FROZEN = 0x00000001
export const KEEB_INFO_F_REORDERING = 0x00000002
export const KEEB_INFO_F_PERSISTENT = 0x00000004

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

/** Ask the user to hold these for REVERT_HOLD_MS when the channel is lost. */
export const LAYER_STATE_NONE = 0xffffffff
