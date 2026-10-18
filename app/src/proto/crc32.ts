/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * CRC-32/IEEE exactly as keeb-module/proto/keeb_tlv.c implements it.
 *
 * Bitwise rather than a table, for the same reason the firmware does it that
 * way: the two sides must agree by construction, not by someone porting a
 * generated polynomial table. The check value "123456789" -> 0xcbf43926 is
 * asserted in tests/codec.test.ts, which is the same assertion tools/tlv_test.c
 * makes on the C side.
 */

import { KEEB_CRC32_START } from './constants.ts'

export const CRC32_POLY = 0xedb88320

/** Streaming form: start at KEEB_CRC32_START, update per chunk, crc32Final once.
 * The state is the inverted CRC, which is why no extra bytes are needed to
 * begin or finish. */
export function crc32Update(state: number, data: Uint8Array, offset = 0, len = data.length - offset): number {
  let s = state >>> 0

  for (let i = offset; i < offset + len; i++) {
    s ^= data[i] & 0xff
    for (let k = 0; k < 8; k++) {
      s = s & 1 ? (s >>> 1) ^ CRC32_POLY : s >>> 1
    }
  }

  return s >>> 0
}

export function crc32Final(state: number): number {
  return ~state >>> 0
}

export function crc32(data: Uint8Array): number {
  return crc32Final(crc32Update(KEEB_CRC32_START, data))
}
