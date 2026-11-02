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
 * This header is the codec API. The protocol specification in code is the pair
 * it includes: keeb_tlv_wire.h (framing: the packet header, the record header,
 * the size limits) and keeb_tlv_records.h (vocabulary: namespaces, record ids,
 * error codes, the display model, every payload struct). Read those two for the
 * wire format; read this one for the functions that produce and consume it.
 *
 * All three are host-compilable on purpose (see tools/tlv_test.c) so the codec
 * is tested without a keyboard: they use no Zephyr types, only stdint and packed
 * structs, and every wire struct's size is a _Static_assert in the file that
 * declares it.
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

#include "keeb_tlv_records.h" /* which pulls in keeb_tlv_wire.h */

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
