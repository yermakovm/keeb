/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Host test for the KEEB TLV codec (keeb-module/proto/keeb_tlv.c).
 *
 * The codec is the part of this feature where a bug is invisible until a
 * keyboard is bricked or, more often, until a layout silently arrives wrong.
 * It is also pure C with no Zephyr dependency, so it is tested here rather than
 * only in the firmware: the same source file the keyboard links is compiled for
 * the host and run against itself.
 *
 * The most valuable test is the loopback in test_loopback(): the real
 * fragmentation code feeds the real reassembly code, so the two halves of the
 * protocol cannot disagree without this failing. It then keeps doing it under
 * dropped fragments, a shrinking MTU, a corrupted byte and a refused oversize.
 *
 * Build and run: tools/tlv_test.sh
 */

#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <stddef.h>

#include "keeb_tlv.h"

/* Shared with the firmware headers, so the test reads like firmware. */
#define ARG_UNUSED(x) (void)(x)

static int checks;
static int failures;

#define CHECK(cond, fmt, ...)                                                                      \
	do {                                                                                       \
		checks++;                                                                          \
		if (!(cond)) {                                                                     \
			failures++;                                                                \
			printf("FAIL %s:%d " fmt "\n", __FILE__, __LINE__, ##__VA_ARGS__);        \
		}                                                                                  \
	} while (0)

/* The value is captured once. Several checks below call a function with side
 * effects (tx_start, rx_feed), and a macro that expands the argument twice
 * would run the call twice and print a different result than it tested.
 */
#define CHECK_EQ(actual, expected, what)                                                           \
	do {                                                                                       \
		long long keeb_actual = (long long)(actual);                                     \
		long long keeb_expected = (long long)(expected);                                 \
		CHECK(keeb_actual == keeb_expected, "%s: got %lld, want %lld", what,             \
		      keeb_actual, keeb_expected);                                               \
	} while (0)

/* --------------------------------------------------------------------------
 * 1. Wire layout
 * -------------------------------------------------------------------------- */

static void test_wire_layout(void)
{
	/* The packet header is copied as raw bytes, so its size and field
	 * offsets are protocol. If a field moves, the configurator's DataView
	 * offsets in app/src/proto/tlv.js move with it.
	 */
	CHECK_EQ(sizeof(struct keeb_pkt_hdr), KEEB_PKT_HDR_SIZE, "packet header size");
	CHECK_EQ(offsetof(struct keeb_pkt_hdr, magic), 0, "hdr.magic offset");
	CHECK_EQ(offsetof(struct keeb_pkt_hdr, version), 2, "hdr.version offset");
	CHECK_EQ(offsetof(struct keeb_pkt_hdr, flags), 3, "hdr.flags offset");
	CHECK_EQ(offsetof(struct keeb_pkt_hdr, msg_id), 4, "hdr.msg_id offset");
	CHECK_EQ(offsetof(struct keeb_pkt_hdr, frag_off), 6, "hdr.frag_off offset");
	CHECK_EQ(offsetof(struct keeb_pkt_hdr, frag_len), 8, "hdr.frag_len offset");
	CHECK_EQ(offsetof(struct keeb_pkt_hdr, msg_len), 10, "hdr.msg_len offset");
	CHECK_EQ(offsetof(struct keeb_pkt_hdr, crc), 12, "hdr.crc offset");

	CHECK_EQ(sizeof(struct keeb_tlv_rec), 4, "record header size");
	CHECK_EQ(sizeof(struct keeb_info), 20, "info size");
	CHECK_EQ(sizeof(struct keeb_ack), 10, "ack size");
	CHECK_EQ(sizeof(struct keeb_notify), 4, "notify size");
	CHECK_EQ(sizeof(struct keeb_cell), 16, "cell size");
	CHECK_EQ(sizeof(struct keeb_cell_set), 16, "cell set size");
	CHECK_EQ(sizeof(struct keeb_cells_hdr), 4, "cells header size");
	CHECK_EQ(sizeof(struct keeb_layers_hdr), 14, "layers header size");
	CHECK_EQ(sizeof(struct keeb_tokens_hdr), 8, "tokens header size");
	CHECK_EQ(sizeof(struct keeb_token_rec), 6, "token record size");
	CHECK_EQ(sizeof(struct keeb_param_value), 14, "param value size");

	/* One layer of a 60-key board must fit one message. */
	CHECK(sizeof(struct keeb_cells_hdr) + 60 * sizeof(struct keeb_cell) < KEEB_TLV_MSG_MAX,
	      "a 60-cell layer must fit one message");

	/* Namespace packing must not collide: a type is (ns << 12) | op. */
	CHECK(KEEB_T_INFO != KEEB_T_CELLS && KEEB_T_TOKENS != KEEB_T_CELLS_SET &&
	      KEEB_T_LAYERS != KEEB_T_LAYER_ADD,
	      "record types must be distinct");
	CHECK((KEEB_T_CELLS_GET >> 12) == KEEB_NS_KEYMAP, "keymap namespace");
	CHECK((KEEB_T_INFO >> 12) == KEEB_NS_SYS, "sys namespace");
}

/* --------------------------------------------------------------------------
 * 2. CRC
 * -------------------------------------------------------------------------- */

static void test_crc(void)
{
	/* Standard CRC-32/IEEE check value: this is the one number both sides
	 * must agree on, and it is public.
	 */
	const uint8_t check[] = "123456789";

	CHECK_EQ(keeb_crc32(check, 9), 0xcbf43926u, "CRC-32/IEEE check value");

	/* Streaming (used for the token-table hash) must equal one-shot. */
	uint32_t state = KEEB_CRC32_START;

	state = keeb_crc32_update(state, check, 4);
	state = keeb_crc32_update(state, check + 4, 5);
	CHECK_EQ(keeb_crc32_final(state), 0xcbf43926u, "streamed CRC equals one-shot");

	static const uint8_t none[1] = { 0 };

	CHECK_EQ(keeb_crc32(none, 0), 0u, "CRC-32/IEEE of empty input is zero");
}

/* --------------------------------------------------------------------------
 * 3. Build and iterate
 * -------------------------------------------------------------------------- */

static void test_build_iterate(void)
{
	uint8_t buf[128];
	struct keeb_tlv_msg msg;

	keeb_tlv_msg_init(&msg, buf, sizeof(buf));

	struct keeb_info info = {
		.proto = KEEB_TLV_VERSION,
		.fw_version = 7,
		.layer_count = 6,
		.key_count = 60,
		.name_max = 20,
		.token_count = 25,
		.token_hash = 0x12345678u,
		.flags = KEEB_INFO_F_PERSISTENT,
	};

	CHECK(keeb_tlv_rec_add_struct(&msg, KEEB_T_INFO, &info, sizeof(info)) == 0,
	      "add info record");

	uint8_t *name = keeb_tlv_rec_add(&msg, KEEB_T_LAYER_NAME_SET, 5);

	CHECK(name != NULL, "add variable-length record");

	if (name) {
		memcpy(name, "\x01" "HOME", 5);
	}

	CHECK_EQ(msg.len, 4 + sizeof(info) + 4 + 5, "message length");

	/* Iterate back. */
	struct keeb_tlv_iter it;

	keeb_tlv_iter_init(&it, buf, msg.len);

	uint16_t type;
	const uint8_t *data;
	uint16_t len;

	CHECK(keeb_tlv_iter_next(&it, &type, &data, &len) == 0, "iterate info");
	CHECK_EQ(type, KEEB_T_INFO, "iterated type");
	CHECK_EQ(len, sizeof(info), "iterated length");

	const struct keeb_info *got = (const struct keeb_info *)data;

	CHECK_EQ(got->key_count, 60, "info key_count survives the wire");
	CHECK_EQ(got->token_hash, 0x12345678u, "info token_hash survives");

	CHECK(keeb_tlv_iter_next(&it, &type, &data, &len) == 0, "iterate name record");
	CHECK_EQ(type, KEEB_T_LAYER_NAME_SET, "name record type");
	CHECK_EQ(len, 5, "name record length");
	CHECK(data[0] == 1 && memcmp(data + 1, "HOME", 4) == 0, "name payload");

	CHECK(keeb_tlv_iter_next(&it, &type, &data, &len) == 1, "iteration ends cleanly");

	/* A full buffer must refuse instead of writing past the end. */
	uint8_t small[8];

	keeb_tlv_msg_init(&msg, small, sizeof(small));
	CHECK(keeb_tlv_rec_add_struct(&msg, KEEB_T_INFO, &info, sizeof(info)) != 0,
	      "overflow refused");
	CHECK_EQ(msg.len, 0, "refused record writes nothing");

	/* A record that claims more than the message holds must be rejected.
	 * This is the malformed-input path that decides whether a confused or
	 * hostile host can steer a read past the buffer.
	 */
	uint8_t torn[8] = { 0x01, 0x10, 0xff, 0xff }; /* len 0xffff, 4 bytes present */

	keeb_tlv_iter_init(&it, torn, sizeof(torn));
	CHECK(keeb_tlv_iter_next(&it, &type, &data, &len) < 0, "torn record rejected");

	uint8_t short_hdr[3] = { 0x01, 0x00, 0x00 };

	keeb_tlv_iter_init(&it, short_hdr, sizeof(short_hdr));
	CHECK(keeb_tlv_iter_next(&it, &type, &data, &len) < 0, "truncated header rejected");

	keeb_tlv_iter_init(&it, NULL, 0);
	CHECK(keeb_tlv_iter_next(&it, &type, &data, &len) == 1, "empty message ends cleanly");
}

/* --------------------------------------------------------------------------
 * 4. Fragment / reassemble loopback
 * -------------------------------------------------------------------------- */

/* A transport that counts sends and can be told to misbehave in exactly the
 * two ways the BLE transport reports: pool empty, MTU smaller than advertised.
 * Everything it "sends" is fed straight into a real receiver, so fragmentation
 * and reassembly are tested against each other.
 */
struct fake_link {
	struct keeb_tlv_tx_dev dev;
	struct keeb_tlv_rx rx;
	uint8_t received[KEEB_TLV_MSG_MAX];
	uint16_t received_len;
	uint16_t sent;
	uint16_t delivered;
	int completed; /* 1 = whole message, else the protocol rejection code */
	int mtu_budget; /* shrink to this once, -1 to disable */
	int mtu_hard;   /* hard ceiling: refuses every packet larger, -1 to disable */
	int busy_budget; /* return BUSY this many times first */
	int drop_at; /* drop this send index (write-no-response loss) */
	int crc_corrupt; /* corrupt one byte before delivering */
};

static void msg_delivered(void *user, uint16_t msg_id, uint8_t flags, const uint8_t *msg,
			  uint16_t len)
{
	struct fake_link *link = user;

	ARG_UNUSED(msg_id);
	ARG_UNUSED(flags);

	link->completed = 1;
	link->received_len = len;

	if (len <= sizeof(link->received)) {
		memcpy(link->received, msg, len);
	}
}

static int fake_send(void *user, const uint8_t *pkt, uint16_t pkt_len)
{
	struct fake_link *link = user;
	int index = link->sent++;

	if (link->busy_budget > 0) {
		link->busy_budget--;
		return KEEB_TX_BUSY;
	}

	if (link->mtu_hard > 0 && pkt_len > (uint16_t)link->mtu_hard) {
		return KEEB_TX_MTU; /* a peer that really cannot carry this size */
	}

	if (link->mtu_budget > 0 && pkt_len > (uint16_t)link->mtu_budget) {
		link->mtu_budget = -1; /* shrink once, then accept */
		return KEEB_TX_MTU;
	}

	if (link->drop_at >= 0 && index == link->drop_at) {
		link->drop_at = -1; /* one loss, like a dropped write */
		return 0;             /* the sender believes it went out */
	}

	uint8_t copy[KEEB_PKT_HDR_SIZE + KEEB_TLV_FRAG_MAX];

	if (pkt_len > sizeof(copy)) {
		return KEEB_TX_FAIL;
	}

	memcpy(copy, pkt, pkt_len);

	if (link->crc_corrupt) {
		/* Damage a payload byte after the header; the CRC must catch it
		 * at completion rather than per fragment.
		 */
		link->crc_corrupt = 0;
		if (pkt_len > KEEB_PKT_HDR_SIZE) {
			copy[KEEB_PKT_HDR_SIZE] ^= 0x80;
		}
	}

	int err = keeb_tlv_rx_feed(&link->rx, copy, pkt_len, msg_delivered, link);

	if (err == 1) {
		link->delivered = pkt_len;
	} else if (err < 0) {
		link->completed = err; /* the protocol's own rejection code */
		return 0;
	}

	return 0;
}

/* Drive a tx to completion, pumping like the engine work item would. */
static int pump_until_done(struct keeb_tlv_tx *tx, int max_rounds)
{
	for (int i = 0; i < max_rounds; i++) {
		int r = keeb_tlv_tx_pump(tx);

		if (r == 0) {
			return 0;
		}
		if (r < 0) {
			return r;
		}
	}

	return -1000; /* stuck */
}

static void test_loopback(void)
{
	uint8_t payload[700];
	struct keeb_tlv_msg msg;

	/* A realistic worst case: one layer of 43 cells plus an ACK. */
	memset(payload, 0xa5, sizeof(payload));
	for (int i = 0; i < (int)sizeof(payload); i++) {
		payload[i] = (uint8_t)(i * 7 + 3);
	}

	/* Fully zeroed: a field left uninitialised here - crc_corrupt in
	 * particular - turns the next case into a phantom failure, which is the
	 * one kind of bug a test must not be able to invent.
	 */
	struct fake_link link = { 0 };

	uint8_t tx_buf[KEEB_TLV_MSG_MAX];
	uint8_t tx_pkt[KEEB_PKT_HDR_SIZE + KEEB_TLV_FRAG_MAX];
	struct keeb_tlv_tx tx = { 0 };

	link.dev.send = fake_send;
	link.dev.user = &link;
	link.dev.max_frag = 46; /* BLE: MTU 65 - 3 (ATT opcode+handle) - 16 (KEEB header) */
	link.rx = (struct keeb_tlv_rx)KEEB_TLV_RX_INIT;
	link.mtu_budget = -1;
	link.busy_budget = 0;
	link.drop_at = -1;

	keeb_tlv_msg_init(&msg, tx_buf, sizeof(tx_buf));
	CHECK(keeb_tlv_rec_add_struct(&msg, KEEB_T_CELLS, payload, sizeof(payload)) == 0,
	      "add big record");

	CHECK(keeb_tlv_tx_start(&tx, &link.dev, tx_pkt, sizeof(tx_pkt), tx_buf,
				(uint16_t)msg.len, 0x1234, KEEB_PKT_F_REPLY) == 1,
	      "tx start queues");

	/* A second message on the same tx while one is in flight must be
	 * refused, not interleaved: the receiver could not untangle two
	 * streams, and the engine's single-buffer design relies on this.
	 */
	CHECK_EQ(keeb_tlv_tx_start(&tx, &link.dev, tx_pkt, sizeof(tx_pkt), tx_buf,
				   (uint16_t)msg.len, 0x1235, KEEB_PKT_F_REPLY),
		 -KEEB_ERR_BUSY, "concurrent send on the same tx refused");

	CHECK(pump_until_done(&tx, 200) == 0, "message completes");
	CHECK_EQ(link.completed, 1, "receiver reported completion");
	/* What arrives is the whole message, record header included. Comparing
	 * payload against the message start would be an off-by-four that looks
	 * exactly like a codec bug.
	 */
	CHECK_EQ(link.received_len, msg.len, "received length matches the message");
	CHECK(memcmp(link.received, tx_buf, msg.len) == 0, "received bytes match");
	CHECK(link.sent >= (msg.len + KEEB_PKT_HDR_SIZE - 1) / 46,
	      "a %u byte message needs many 46 byte fragments (%u sent)", (uint16_t)msg.len,
	      link.sent);
}

static void test_fragment_failure_modes(void)
{
	uint8_t payload[400];
	uint8_t tx_buf[KEEB_TLV_MSG_MAX];
	uint8_t tx_pkt[KEEB_PKT_HDR_SIZE + KEEB_TLV_FRAG_MAX];
	struct keeb_tlv_tx tx = { 0 };
	struct fake_link link;
	struct keeb_tlv_msg msg;

	for (int i = 0; i < (int)sizeof(payload); i++) {
		payload[i] = (uint8_t)(i ^ 0x3c);
	}

	/* Case A: the peer turns out to have a smaller MTU. The sender must
	 * shrink and re-send the same offset, and the receiver must still get
	 * the message intact.
	 */
	memset(&link, 0, sizeof(link));
	memset(&tx, 0, sizeof(tx));
	link.dev.send = fake_send;
	link.dev.user = &link;
	link.dev.max_frag = 46;
	link.rx = (struct keeb_tlv_rx)KEEB_TLV_RX_INIT;
	link.mtu_budget = 40; /* first oversized fragment triggers the shrink */
	link.drop_at = -1;

	keeb_tlv_msg_init(&msg, tx_buf, sizeof(tx_buf));
	keeb_tlv_rec_add_struct(&msg, KEEB_T_CELLS, payload, sizeof(payload));

	keeb_tlv_tx_start(&tx, &link.dev, tx_pkt, sizeof(tx_pkt), tx_buf, (uint16_t)msg.len, 7,
			  KEEB_PKT_F_REPLY);
	CHECK(pump_until_done(&tx, 400) == 0, "small-MTU retry completes");
	CHECK_EQ(link.completed, 1, "small-MTU message completed");
	CHECK(memcmp(link.received, tx_buf, msg.len) == 0, "small-MTU bytes match");

	/* Case B: TX pool empty. The fragment is retried unchanged. */
	memset(&link, 0, sizeof(link));
	memset(&tx, 0, sizeof(tx));
	link.dev.send = fake_send;
	link.dev.user = &link;
	link.dev.max_frag = 46;
	link.rx = (struct keeb_tlv_rx)KEEB_TLV_RX_INIT;
	link.mtu_budget = -1;
	link.busy_budget = 3;
	link.drop_at = -1;

	keeb_tlv_msg_init(&msg, tx_buf, sizeof(tx_buf));
	keeb_tlv_rec_add_struct(&msg, KEEB_T_CELLS, payload, sizeof(payload));

	keeb_tlv_tx_start(&tx, &link.dev, tx_pkt, sizeof(tx_pkt), tx_buf, (uint16_t)msg.len, 8,
			  KEEB_PKT_F_REPLY);
	CHECK(pump_until_done(&tx, 400) == 0, "busy retry completes");
	CHECK_EQ(link.completed, 1, "busy message completed");
	CHECK(memcmp(link.received, tx_buf, msg.len) == 0, "busy bytes match");

	/* Case C: a fragment is lost in flight (write-no-response loss). The
	 * receiver must reject the out-of-order fragment, and the sender must
	 * recover by restarting from offset 0 with KEEB_PKT_F_FIRST.
	 */
	memset(&link, 0, sizeof(link));
	memset(&tx, 0, sizeof(tx));
	link.dev.send = fake_send;
	link.dev.user = &link;
	link.dev.max_frag = 46;
	link.rx = (struct keeb_tlv_rx)KEEB_TLV_RX_INIT;
	link.mtu_budget = -1;
	link.drop_at = 2; /* third fragment vanishes */

	keeb_tlv_msg_init(&msg, tx_buf, sizeof(tx_buf));
	keeb_tlv_rec_add_struct(&msg, KEEB_T_CELLS, payload, sizeof(payload));

	keeb_tlv_tx_start(&tx, &link.dev, tx_pkt, sizeof(tx_pkt), tx_buf, (uint16_t)msg.len, 9,
			  KEEB_PKT_F_REPLY);
	int r = pump_until_done(&tx, 400);

	CHECK(r == 0, "send side does not notice the loss");
	CHECK_EQ(link.completed, -KEEB_ERR_BAD_SEQ, "receiver rejects the gap with BAD_SEQ");

	/* Restart the message and it must land. */
	link.completed = 0;
	keeb_tlv_tx_start(&tx, &link.dev, tx_pkt, sizeof(tx_pkt), tx_buf, (uint16_t)msg.len, 9,
			  KEEB_PKT_F_REPLY);
	CHECK(pump_until_done(&tx, 400) == 0, "restart completes");
	CHECK_EQ(link.completed, 1, "restart delivered a whole message");
	CHECK(memcmp(link.received, tx_buf, msg.len) == 0, "restart bytes match");

	/* Case D: the peer's MTU cannot carry even the smallest fragment the
	 * sender is willing to use. Halving further is not a recovery, so the
	 * sender must give up and report it - the alternative is the engine
	 * re-arming the same fragment every KEEB_TX_RETRY_MS forever, which is
	 * what a real board shows as an endless "No buffer available to send
	 * notification" log.
	 */
	memset(&link, 0, sizeof(link));
	memset(&tx, 0, sizeof(tx));
	link.dev.send = fake_send;
	link.dev.user = &link;
	link.dev.max_frag = 46;
	link.rx = (struct keeb_tlv_rx)KEEB_TLV_RX_INIT;
	link.mtu_budget = -1;
	link.mtu_hard = KEEB_PKT_HDR_SIZE + KEEB_TLV_FRAG_MIN - 1; /* one byte short */
	link.drop_at = -1;

	keeb_tlv_msg_init(&msg, tx_buf, sizeof(tx_buf));
	keeb_tlv_rec_add_struct(&msg, KEEB_T_CELLS, payload, sizeof(payload));

	keeb_tlv_tx_start(&tx, &link.dev, tx_pkt, sizeof(tx_pkt), tx_buf, (uint16_t)msg.len, 12,
			  KEEB_PKT_F_REPLY);
	r = pump_until_done(&tx, 400);

	CHECK(r < 0 && r != -1000, "a link too small for the protocol is reported, not retried");
	CHECK(!tx.busy, "the dropped message releases the tx so the next request can be served");
	CHECK_EQ(link.completed, 0, "nothing was completed on a link that cannot carry it");
}

static void test_input_rejections(void)
{
	uint8_t tx_buf[KEEB_TLV_MSG_MAX];
	uint8_t tx_pkt[KEEB_PKT_HDR_SIZE + KEEB_TLV_FRAG_MAX];
	struct keeb_tlv_tx tx = { 0 };
	struct keeb_tlv_msg msg;
	struct fake_link link;

	memset(&link, 0, sizeof(link));
	memset(&tx, 0, sizeof(tx));
	link.dev.send = fake_send;
	link.dev.user = &link;
	link.dev.max_frag = 46;
	link.rx = (struct keeb_tlv_rx)KEEB_TLV_RX_INIT;
	link.mtu_budget = -1;
	link.drop_at = -1;

	/* Corrupted payload: caught at completion by the message CRC. */
	keeb_tlv_msg_init(&msg, tx_buf, sizeof(tx_buf));
	keeb_tlv_rec_add_struct(&msg, KEEB_T_CELLS, (const uint8_t *)"abc", 3);
	link.crc_corrupt = 1;

	keeb_tlv_tx_start(&tx, &link.dev, tx_pkt, sizeof(tx_pkt), tx_buf, (uint16_t)msg.len, 10,
			  KEEB_PKT_F_REPLY);
	CHECK(pump_until_done(&tx, 50) == 0, "sender thinks it sent");
	CHECK_EQ(link.completed, -KEEB_ERR_BAD_CRC, "corruption caught by CRC");

	/* Oversized message: refused before anything is written. */
	struct keeb_pkt_hdr hdr;
	uint8_t pkt[KEEB_PKT_HDR_SIZE + 4];

	memset(pkt, 0, sizeof(pkt));
	hdr.magic = KEEB_TLV_MAGIC;
	hdr.version = KEEB_TLV_VERSION;
	hdr.flags = KEEB_PKT_F_FIRST;
	hdr.msg_id = 11;
	hdr.frag_off = 0;
	hdr.frag_len = 4;
	hdr.msg_len = KEEB_TLV_MSG_MAX + 1;
	hdr.crc = 0;
	keeb_pkt_hdr_put(&hdr, pkt);
	memcpy(pkt + KEEB_PKT_HDR_SIZE, "abcd", 4);

	memset(&link.rx, 0, sizeof(link.rx));
	CHECK_EQ(keeb_tlv_rx_feed(&link.rx, pkt, sizeof(pkt), msg_delivered, &link),
		 -KEEB_ERR_TOO_BIG, "oversized message refused");

	/* Wrong magic and wrong version. */
	hdr.magic = 0x1234;
	keeb_pkt_hdr_put(&hdr, pkt);
	CHECK_EQ(keeb_tlv_rx_feed(&link.rx, pkt, sizeof(pkt), msg_delivered, &link),
		 -KEEB_ERR_BAD_MAGIC, "foreign magic refused");

	hdr.magic = KEEB_TLV_MAGIC;
	hdr.version = 9;
	keeb_pkt_hdr_put(&hdr, pkt);
	CHECK_EQ(keeb_tlv_rx_feed(&link.rx, pkt, sizeof(pkt), msg_delivered, &link),
		 -KEEB_ERR_BAD_VERSION, "unknown version refused");

	/* Header/payload length disagreement. */
	hdr.version = KEEB_TLV_VERSION;
	hdr.msg_len = 4;
	hdr.frag_len = 1; /* claims 1 payload byte, packet carries 4 */
	keeb_pkt_hdr_put(&hdr, pkt);
	CHECK_EQ(keeb_tlv_rx_feed(&link.rx, pkt, sizeof(pkt), msg_delivered, &link),
		 -KEEB_ERR_BAD_LEN, "lying fragment length refused");

	/* Fragment offset outside the message. */
	hdr.frag_len = 4;
	hdr.frag_off = 8; /* message is 4 bytes */
	keeb_pkt_hdr_put(&hdr, pkt);
	CHECK_EQ(keeb_tlv_rx_feed(&link.rx, pkt, sizeof(pkt), msg_delivered, &link),
		 -KEEB_ERR_BAD_LEN, "fragment outside the message refused");

	/* A continuation without a message in progress: the packet itself is
	 * well-formed (offset 4 of an 8 byte message), so the only thing wrong
	 * is the missing KEEB_PKT_F_FIRST on a receiver that is idle.
	 */
	hdr.msg_len = 8;
	hdr.frag_off = 4;
	hdr.frag_len = 4;
	hdr.flags = 0; /* no FIRST, and rx is idle */
	memset(&link.rx, 0, sizeof(link.rx));
	keeb_pkt_hdr_put(&hdr, pkt);
	CHECK_EQ(keeb_tlv_rx_feed(&link.rx, pkt, sizeof(pkt), msg_delivered, &link),
		 -KEEB_ERR_BAD_SEQ, "continuation with no message refused");

	/* Too small to even be a header. */
	CHECK_EQ(keeb_tlv_rx_feed(&link.rx, pkt, 4, msg_delivered, &link), -KEEB_ERR_BAD_LEN,
		 "short packet refused");
}

static void test_header_round_trip(void)
{
	struct keeb_pkt_hdr src = {
		.magic = KEEB_TLV_MAGIC,
		.version = KEEB_TLV_VERSION,
		.flags = KEEB_PKT_F_FIRST | KEEB_PKT_F_REPLY,
		.msg_id = 0x0102,
		.frag_off = 0x0304,
		.frag_len = 0x0506,
		.msg_len = 0x0708,
		.crc = 0x0b0c0d0eu,
	};
	uint8_t wire[KEEB_PKT_HDR_SIZE];
	struct keeb_pkt_hdr dst;

	keeb_pkt_hdr_put(&src, wire);
	keeb_pkt_hdr_get(wire, &dst);

	CHECK_EQ(dst.magic, src.magic, "hdr magic");
	CHECK_EQ(dst.flags, src.flags, "hdr flags");
	CHECK_EQ(dst.msg_id, src.msg_id, "hdr msg_id");
	CHECK_EQ(dst.frag_off, src.frag_off, "hdr frag_off");
	CHECK_EQ(dst.frag_len, src.frag_len, "hdr frag_len");
	CHECK_EQ(dst.msg_len, src.msg_len, "hdr msg_len");
	CHECK_EQ(dst.crc, src.crc, "hdr crc");

	/* Little-endian, because the configurator builds these with
	 * DataView({}) setUint16(..., true). Spot-check one field.
	 */
	CHECK_EQ(wire[4], 0x02, "msg_id low byte first");
	CHECK_EQ(wire[5], 0x01, "msg_id high byte second");
	CHECK_EQ(wire[12], 0x0e, "crc byte 0");
	CHECK_EQ(wire[15], 0x0b, "crc last byte");
}

int main(void)
{
	printf("keeb tlv codec test\n");

	test_wire_layout();
	test_crc();
	test_build_iterate();
	test_header_round_trip();
	test_loopback();
	test_fragment_failure_modes();
	test_input_rejections();

	printf("%d checks, %d failures\n", checks, failures);

	if (failures) {
		printf("FAILED\n");
		return 1;
	}

	printf("ok\n");
	return 0;
}
