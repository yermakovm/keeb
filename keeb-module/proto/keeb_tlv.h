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
 * (and the notification MTU here is CONFIG_BT_L2CAP_TX_MTU = 65, i.e. 62 bytes
 * of payload per notification), a message is split into *packets*, each one
 * carrying a byte range of the message:
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
 * (62 bytes, MTU 65 minus 3 for the ATT opcode and handle), but the staging
 * buffer is sized from this constant so a transport with a bigger MTU never
 * overruns it.
 */
#define KEEB_TLV_FRAG_MAX 128

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

/* --------------------------------------------------------------------------
 * Namespaces and record types
 * -------------------------------------------------------------------------- */

#define KEEB_NS_SYS 0x0u
#define KEEB_NS_KEYMAP 0x1u
#define KEEB_NS_DISPLAY 0x2u    /* unused yet: panel/image selection */
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
