/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * KEEB TLV codec: CRC-32, packet header byte handling, message building,
 * message iterating, receive reassembly and send fragmentation. The protocol
 * itself is specified in keeb_tlv.h.
 *
 * Deliberately plain C (no Zephyr headers): the same source is linked into the
 * keyboard and into tools/tlv_test.c, so the protocol logic is verified on the
 * host instead of only on a wrist.
 */

#include "keeb_tlv.h"

#include <string.h>

/* Local MIN: Zephyr's MIN lives in compiler.h, which is not in scope here. */
#define KEEB_MIN(a, b) ((uint16_t)((a) < (b) ? (a) : (b)))

static void put_le16(uint8_t *p, uint16_t v)
{
	p[0] = (uint8_t)(v & 0xffu);
	p[1] = (uint8_t)((v >> 8) & 0xffu);
}

static void put_le32(uint8_t *p, uint32_t v)
{
	p[0] = (uint8_t)(v & 0xffu);
	p[1] = (uint8_t)((v >> 8) & 0xffu);
	p[2] = (uint8_t)((v >> 16) & 0xffu);
	p[3] = (uint8_t)((v >> 24) & 0xffu);
}

static uint16_t get_le16(const uint8_t *p)
{
	return (uint16_t)(p[0] | (p[1] << 8));
}

static uint32_t get_le32(const uint8_t *p)
{
	return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) |
	       ((uint32_t)p[3] << 24);
}

uint32_t keeb_crc32_update(uint32_t state, const uint8_t *data, uint16_t len)
{
	/* Table-free bitwise CRC-32/IEEE. Eight iterations per byte are cheap
	 * next to the 1 KB table this firmware has no reason to spend, and the
	 * loop is identical on the host, so both sides agree by construction
	 * rather than by someone porting a generated table.
	 */
	for (uint16_t i = 0; i < len; i++) {
		state ^= data[i];
		for (int k = 0; k < 8; k++) {
			state = (state & 1u) ? ((state >> 1) ^ 0xedb88320u) : (state >> 1);
		}
	}

	return state;
}

uint32_t keeb_crc32_final(uint32_t state)
{
	return ~state;
}

uint32_t keeb_crc32(const uint8_t *data, uint16_t len)
{
	return keeb_crc32_final(keeb_crc32_update(KEEB_CRC32_START, data, len));
}

void keeb_pkt_hdr_put(const struct keeb_pkt_hdr *hdr, uint8_t *out)
{
	put_le16(out + 0, hdr->magic);
	out[2] = hdr->version;
	out[3] = hdr->flags;
	put_le16(out + 4, hdr->msg_id);
	put_le16(out + 6, hdr->frag_off);
	put_le16(out + 8, hdr->frag_len);
	put_le16(out + 10, hdr->msg_len);
	put_le32(out + 12, hdr->crc);
}

void keeb_pkt_hdr_get(const uint8_t *in, struct keeb_pkt_hdr *out)
{
	out->magic = get_le16(in + 0);
	out->version = in[2];
	out->flags = in[3];
	out->msg_id = get_le16(in + 4);
	out->frag_off = get_le16(in + 6);
	out->frag_len = get_le16(in + 8);
	out->msg_len = get_le16(in + 10);
	out->crc = get_le32(in + 12);
}

/* --------------------------------------------------------------------------
 * Building
 * -------------------------------------------------------------------------- */

void keeb_tlv_msg_init(struct keeb_tlv_msg *msg, uint8_t *buf, uint16_t cap)
{
	msg->buf = buf;
	msg->cap = cap;
	msg->len = 0;
}

void *keeb_tlv_rec_add(struct keeb_tlv_msg *msg, uint16_t type, uint16_t value_len)
{
	uint32_t need = (uint32_t)sizeof(struct keeb_tlv_rec) + value_len;

	/* msg->len <= msg->cap is the invariant keeb_tlv_msg_init() sets and
	 * the only place len grows, so this subtraction cannot wrap.
	 */
	if (need > (uint32_t)(msg->cap - msg->len)) {
		return NULL;
	}

	put_le16(msg->buf + msg->len + 0, type);
	put_le16(msg->buf + msg->len + 2, value_len);
	msg->len = (uint16_t)(msg->len + (uint16_t)sizeof(struct keeb_tlv_rec) + value_len);

	return msg->buf + msg->len - value_len;
}

int keeb_tlv_rec_add_struct(struct keeb_tlv_msg *msg, uint16_t type, const void *value,
			    uint16_t value_len)
{
	void *dst = keeb_tlv_rec_add(msg, type, value_len);

	if (!dst) {
		return -1;
	}

	memcpy(dst, value, value_len);

	return 0;
}

/* --------------------------------------------------------------------------
 * Iterating
 * -------------------------------------------------------------------------- */

void keeb_tlv_iter_init(struct keeb_tlv_iter *it, const uint8_t *msg, uint16_t len)
{
	it->p = msg;
	it->left = len;
}

int keeb_tlv_iter_next(struct keeb_tlv_iter *it, uint16_t *type, const uint8_t **data,
		       uint16_t *data_len)
{
	if (it->left == 0) {
		return 1; /* end of message */
	}

	if (it->left < (uint16_t)sizeof(struct keeb_tlv_rec)) {
		return -1; /* truncated record header */
	}

	uint16_t t = get_le16(it->p + 0);
	uint16_t l = get_le16(it->p + 2);

	if (l > (uint16_t)(it->left - (uint16_t)sizeof(struct keeb_tlv_rec))) {
		return -1; /* record claims more than the message holds */
	}

	*type = t;
	*data = it->p + sizeof(struct keeb_tlv_rec);
	*data_len = l;

	it->p += sizeof(struct keeb_tlv_rec) + l;
	it->left = (uint16_t)(it->left - (uint16_t)sizeof(struct keeb_tlv_rec) - l);

	return 0;
}

/* --------------------------------------------------------------------------
 * Receiving
 * -------------------------------------------------------------------------- */

int keeb_tlv_rx_feed(struct keeb_tlv_rx *rx, const uint8_t *pkt, uint16_t pkt_len,
		     keeb_tlv_msg_cb cb, void *user)
{
	if (pkt_len < KEEB_PKT_HDR_SIZE) {
		return -KEEB_ERR_BAD_LEN;
	}

	struct keeb_pkt_hdr hdr;

	keeb_pkt_hdr_get(pkt, &hdr);

	if (hdr.magic != KEEB_TLV_MAGIC) {
		return -KEEB_ERR_BAD_MAGIC;
	}

	if (hdr.version != KEEB_TLV_VERSION) {
		return -KEEB_ERR_BAD_VERSION;
	}

	if (hdr.frag_len != (uint16_t)(pkt_len - KEEB_PKT_HDR_SIZE)) {
		return -KEEB_ERR_BAD_LEN;
	}

	if (hdr.msg_len == 0u || hdr.msg_len > KEEB_TLV_MSG_MAX) {
		return -KEEB_ERR_TOO_BIG;
	}

	if (hdr.frag_off > hdr.msg_len || hdr.frag_len > (uint16_t)(hdr.msg_len - hdr.frag_off)) {
		return -KEEB_ERR_BAD_LEN;
	}

	if (hdr.flags & KEEB_PKT_F_FIRST) {
		rx->msg_len = hdr.msg_len;
		rx->got = 0;
		rx->msg_id = hdr.msg_id;
		rx->flags = hdr.flags;
	} else {
		if (rx->msg_len == 0u) {
			return -KEEB_ERR_BAD_SEQ; /* sender must restart */
		}
		if (hdr.msg_len != rx->msg_len || hdr.msg_id != rx->msg_id) {
			return -KEEB_ERR_BAD_SEQ;
		}
		/* The in-order rule from the header note: a lost
		 * write-without-response fragment lands here, and the only
		 * correct recovery is the sender restarting at offset 0 with
		 * KEEB_PKT_F_FIRST set.
		 */
		if (hdr.frag_off != rx->got) {
			return -KEEB_ERR_BAD_SEQ;
		}
	}

	memcpy(rx->buf + hdr.frag_off, pkt + KEEB_PKT_HDR_SIZE, hdr.frag_len);
	rx->got = (uint16_t)(rx->got + hdr.frag_len);

	if (rx->got < rx->msg_len) {
		return 0;
	}

	uint16_t msg_len = rx->msg_len;
	uint16_t msg_id = rx->msg_id;
	uint8_t flags = rx->flags;

	rx->msg_len = 0;
	rx->got = 0;

	if (keeb_crc32(rx->buf, msg_len) != hdr.crc) {
		return -KEEB_ERR_BAD_CRC;
	}

	if (cb) {
		cb(user, msg_id, flags, rx->buf, msg_len);
	}

	return 1;
}

/* --------------------------------------------------------------------------
 * Sending
 * -------------------------------------------------------------------------- */

int keeb_tlv_tx_start(struct keeb_tlv_tx *tx, const struct keeb_tlv_tx_dev *dev, uint8_t *pkt,
		      uint16_t pkt_cap, const uint8_t *msg, uint16_t msg_len, uint16_t msg_id,
		      uint8_t flags)
{
	if (tx->busy) {
		return -KEEB_ERR_BUSY;
	}

	if (!dev || !dev->send || !pkt || !msg) {
		return -KEEB_ERR_BAD_LEN;
	}

	if (msg_len == 0u || msg_len > KEEB_TLV_MSG_MAX) {
		return -KEEB_ERR_TOO_BIG;
	}

	if (pkt_cap < (uint16_t)(KEEB_PKT_HDR_SIZE + KEEB_TLV_FRAG_MIN)) {
		return -KEEB_ERR_BAD_LEN;
	}

	uint16_t frag_cap = (uint16_t)(pkt_cap - KEEB_PKT_HDR_SIZE);
	uint16_t frag = KEEB_MIN((uint16_t)KEEB_TLV_FRAG_MAX, frag_cap);

	frag = KEEB_MIN(frag, dev->max_frag);

	if (frag < KEEB_TLV_FRAG_MIN) {
		return -KEEB_ERR_BAD_LEN;
	}

	tx->dev = dev;
	tx->pkt = pkt;
	tx->msg = msg;
	tx->msg_len = msg_len;
	tx->off = 0;
	tx->frag = frag;
	tx->msg_id = msg_id;
	tx->flags = flags;
	tx->busy = 1;
	tx->last_err = 0;
	/* The CRC covers the whole message and the message cannot change while
	 * it is in flight, so it is computed once here and carried by every
	 * fragment.
	 */
	tx->crc = keeb_crc32(msg, msg_len);

	return 1; /* pending: keeb_tlv_tx_pump() has work to do */
}

int keeb_tlv_tx_pump(struct keeb_tlv_tx *tx)
{
	if (!tx->busy) {
		return 0; /* nothing in flight */
	}

	uint16_t frag_len = KEEB_MIN(tx->frag, (uint16_t)(tx->msg_len - tx->off));
	bool first = (tx->off == 0);

	struct keeb_pkt_hdr hdr = {
		.magic = KEEB_TLV_MAGIC,
		.version = KEEB_TLV_VERSION,
		.flags = (uint8_t)(tx->flags | (first ? KEEB_PKT_F_FIRST : 0)),
		.msg_id = tx->msg_id,
		.frag_off = tx->off,
		.frag_len = frag_len,
		.msg_len = tx->msg_len,
		.crc = tx->crc,
	};

	keeb_pkt_hdr_put(&hdr, tx->pkt);
	memcpy(tx->pkt + KEEB_PKT_HDR_SIZE, tx->msg + tx->off, frag_len);

	int err = tx->dev->send(tx->dev->user, tx->pkt,
				(uint16_t)(KEEB_PKT_HDR_SIZE + frag_len));

	tx->last_err = err;

	if (err == 0) {
		tx->off = (uint16_t)(tx->off + frag_len);

		if (tx->off >= tx->msg_len) {
			tx->busy = 0;
			return 0; /* message delivered */
		}

		return 1; /* more fragments pending */
	}

	if (err == KEEB_TX_MTU) {
		/* The peer's MTU is smaller than the transport advertised.
		 * Offset-based reassembly makes re-sending the same bytes legal,
		 * so shrinking needs no coordination with the receiver: halve the
		 * fragment and retry the same offset.
		 */
		if (tx->frag <= KEEB_TLV_FRAG_MIN) {
			/* Already at the floor and the peer still cannot carry
			 * the packet: this link cannot run the protocol. Saying so
			 * beats retrying the same fragment every 20 ms.
			 */
			tx->busy = 0;
			return -1;
		}

		tx->frag = (uint16_t)(tx->frag / 2);

		if (tx->frag < KEEB_TLV_FRAG_MIN) {
			tx->frag = KEEB_TLV_FRAG_MIN;
		}

		return 1;
	}

	if (err == KEEB_TX_FAIL) {
		tx->busy = 0;
		return -1;
	}

	/* KEEB_TX_BUSY and anything unforeseen: keep the message where it is
	 * and let the caller retry later. Dropping half of a layout would be
	 * worse than being slow.
	 */
	return 1;
}
