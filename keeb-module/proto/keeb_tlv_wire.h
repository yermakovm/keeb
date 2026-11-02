/*
 * Copyright (c) 2025 The keeb keyboard authors
 * SPDX-License-Identifier: MIT
 *
 * KEEB TLV wire protocol - framing.
 *
 * The packet header, the record header, and the sizes a sender and a receiver must
 * agree on before any record can be read. This half stands on its own: the BLE
 * transport and the host test need it without the payload vocabulary. Everything
 * else includes keeb_tlv.h.
 *
 * Packed and little-endian - the byte layout IS the protocol. The asserts at the
 * bottom of this file are what makes that safe to rely on: add a field to a wire
 * struct, a sizeof changes, and this file stops compiling instead of the app
 * reading a field four bytes to the right.
 */
#ifndef KEEB_MODULE_PROTO_TLV_WIRE_H
#define KEEB_MODULE_PROTO_TLV_WIRE_H

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
 * On-wire framing (packed, little-endian)
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

/* --------------------------------------------------------------------------
 * Framing size asserts. The app reads these with DataView offsets and the
 * transport copies them byte by byte, so a layout change is a silent misread at
 * the other end of the link unless it is asserted here.
 * -------------------------------------------------------------------------- */

_Static_assert(sizeof(struct keeb_pkt_hdr) == KEEB_PKT_HDR_SIZE,
               "struct keeb_pkt_hdr no longer matches KEEB_PKT_HDR_SIZE");
_Static_assert(KEEB_PKT_HDR_SIZE == 16, "the packet header is not 16 bytes");
_Static_assert(sizeof(struct keeb_tlv_rec) == 4, "a TLV record header is not 4 bytes");
_Static_assert(KEEB_TLV_MSG_MAX >= KEEB_TLV_FRAG_MAX,
               "KEEB_TLV_MSG_MAX is smaller than one fragment");
_Static_assert(KEEB_TLV_FRAG_MAX > KEEB_TLV_FRAG_MIN,
               "the fragment fallback grows instead of shrinking");
_Static_assert(KEEB_TLV_FRAG_MIN + KEEB_PKT_HDR_SIZE + 3 <= 65,
               "the smallest fragment no longer fits one ATT PDU");

#endif /* KEEB_MODULE_PROTO_TLV_WIRE_H */
