/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * The rest of the app imports the protocol from here.
 *
 * The numbers themselves are generated — see ./protocol.gen.ts, which
 * app/scripts/gen-contract.mjs writes from keeb-module/proto/keeb_tlv_wire.h,
 * keeb_tlv_records.h and keeb_tlv.h. Re-run `npm run gen` after touching a
 * header. Hand-copying them was the one place where the configurator and the
 * firmware could quietly disagree, so they are not hand-copied any more.
 *
 * What is left in this file is what the generator cannot see:
 *   - the function-like macros (KEEB_TLV_TYPE and friends), which C expands
 *     and TypeScript has to implement,
 *   - the BLE transport numbers, which keeb_ble.c derives from Zephyr's Kconfig
 *     MTU rather than from a #define,
 *   - the vendor UUIDs, built by BT_UUID_128_ENCODE,
 *   - ZMK's own enums that are not part of the KEEB headers,
 *   - the tables the app builds out of those constants (error text, pip gaps).
 */

import {
  KEEB_ERR_BAD_CRC,
  KEEB_ERR_BAD_LEN,
  KEEB_ERR_BAD_MAGIC,
  KEEB_ERR_BAD_SEQ,
  KEEB_ERR_BAD_VERSION,
  KEEB_ERR_BAD_WIDGET,
  KEEB_ERR_BEHAVIOR,
  KEEB_ERR_BUSY,
  KEEB_ERR_NONE,
  KEEB_ERR_NO_SPACE,
  KEEB_ERR_NOT_SUPPORTED,
  KEEB_ERR_OUT_OF_RANGE,
  KEEB_ERR_RESERVED_POSITION,
  KEEB_ERR_STORAGE,
  KEEB_ERR_TOO_BIG,
  KEEB_ERR_UNKNOWN_TOKEN,
  KEEB_ERR_UNKNOWN_TYPE,
  KEEB_PKT_HDR_SIZE,
  KEEB_PIPS_LARGE,
  KEEB_PIPS_SMALL,
  KEEB_PIPS_TINY,
} from './protocol.gen.ts'

/* Re-export the generated contract: the rest of the app imports the protocol
 * from this module, and a name that exists in the firmware header exists here. */
export * from './protocol.gen.ts'

/* --------------------------------------------------------------------------
 * Function-like macros: the C side expands these, the app has to compute them.
 * Keep them byte-for-byte equivalent to the #define they mirror.
 * -------------------------------------------------------------------------- */

/** keeb_tlv_records.h: `(uint16_t)(((ns) << 12) | (op))`. */
export const KEEB_TLV_TYPE = (ns: number, op: number): number => ((ns << 12) | op) & 0xffff

/** keeb_tlv_records.h KEEB_STYLE_* — a widget's style byte. */
export const KEEB_STYLE_FONT = (style: number): number => style & 0x3
export const KEEB_STYLE_ALIGN = (style: number): number => (style >> 2) & 0x3
export const KEEB_TEXT_STYLE = (font: number, align: number): number =>
  (font & 0x3) | ((align & 0x3) << 2)

/* --------------------------------------------------------------------------
 * BLE transport. The keyboard's fragment size is not a protocol constant: it is
 * CONFIG_BT_L2CAP_TX_MTU minus the ATT wrapper minus the KEEB packet header,
 * and keeb_ble.c computes it from Kconfig (KEEB_BLE_MAX_FRAG). These three are
 * the app's copy of that arithmetic; if the MTU is ever raised in keeb.conf,
 * this is the file to change, and device.test.ts's fragmentation cases fail if
 * the two ends stop agreeing.
 * -------------------------------------------------------------------------- */

/** Zephyr's ATT/notification budget on the keyboard (CONFIG_BT_L2CAP_TX_MTU). */
export const KEEB_BLE_ATT_MTU = 65

/** ATT bytes around a GATT payload: opcode + attribute handle. */
export const KEEB_ATT_OVERHEAD = 3

/** Fragment payload a BLE fragment can carry. The ATT PDU holds the opcode, the
 * handle and the *whole* KEEB packet — the 16 byte header is part of the
 * notification payload, not overhead the transport can ignore. Mirrors
 * KEEB_BLE_MAX_FRAG in keeb-module/transport/keeb_ble.c.
 */
export const KEEB_BLE_FRAG_PAYLOAD = KEEB_BLE_ATT_MTU - KEEB_ATT_OVERHEAD - KEEB_PKT_HDR_SIZE

/* --------------------------------------------------------------------------
 * Tables the app builds from the generated constants.
 * -------------------------------------------------------------------------- */

/** KEEB_WID_PIPS pip geometry presets: (pip_w, pip_h, gap). */
export const KEEB_PIPS_GEOMETRY: Record<number, { gap: number }> = {
  [KEEB_PIPS_SMALL]: { gap: 2 },
  [KEEB_PIPS_LARGE]: { gap: 3 },
  [KEEB_PIPS_TINY]: { gap: 2 },
}

/** What an ACK's err_code means, for the message a user actually sees. */
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

/** struct keeb_display_info.preset when the table is one the host built.
 * Not in the firmware headers: the firmware reports a built-in preset id and
 * the app uses this one for a table that is none of them. */
export const KBEEB_PRESET_CUSTOM = 0xff

/* --------------------------------------------------------------------------
 * Not KEEB protocol: ZMK's own parameter typing, and the GATT identities.
 * -------------------------------------------------------------------------- */

/** enum behavior_parameter_value_type in zmk/app/include/zmk/behavior.h —
 * what a token's param1/param2 mean, reported by KEEB_T_TOKEN_PARAMS. */
export const BEHAVIOR_PARAMETER_VALUE_TYPE_NIL = 0
export const BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE = 1
export const BEHAVIOR_PARAMETER_VALUE_TYPE_RANGE = 2
export const BEHAVIOR_PARAMETER_VALUE_TYPE_HID_USAGE = 3
export const BEHAVIOR_PARAMETER_VALUE_TYPE_LAYER_ID = 4

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
 * only HID devices" is not a narrowing this API allows — it is forbidden. The
 * chooser filters by the advertised name instead, which the generator takes
 * from CONFIG_ZMK_KEYBOARD_NAME (KEYBOARD_NAME in zmk.gen.ts).
 *
 * Kept as a comment with a constant so nobody re-adds it as a filter.
 */
export const KEEB_HID_SERVICE_UUID_BLOCKLISTED = '00001812-0000-1000-8000-00805f9b34fb'

/** Ask the user to hold these for REVERT_HOLD_MS when the channel is lost. */
export const LAYER_STATE_NONE = 0xffffffff
