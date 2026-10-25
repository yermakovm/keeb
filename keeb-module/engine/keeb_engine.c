/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Config engine implementation. See keeb_engine.h for the model.
 *
 * Worked assumptions worth stating:
 *
 *   - One attached configurator at a time. The reply to a request is held until
 *     it has been delivered, and while it is held a new request is refused with
 *     KEEB_ERR_BUSY. That serialises the session without a mutex, which is what
 *     lets the reassembly buffer and the reply buffer be reused instead of
 *     duplicated.
 *   - A reply message carries the ACK record plus any response records, so one
 *     request costs one message and the host always learns the outcome.
 *   - Records inside a message are applied in order, and the ACK reports the
 *     first failure. Only a KEEB_T_CELLS_SET record is all-or-nothing, because
 *     that is the one the core can validate completely before writing.
 *   - Fragment retry happens on the work queue with a fixed delay. A stalled
 *     Bluetooth TX pool is temporary; dropping half a layout would not be.
 */

#include <zephyr/devicetree.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <string.h>

#include <zmk/event_manager.h>
#include <zmk/events/layer_state_changed.h>
#include <zmk/keymap.h>

#include "../display/keeb_display.h"
#include "../keymap/keeb_keymap.h"
#include "../keymap/keeb_tokens.h"
#include "../proto/keeb_tlv.h"
#include "keeb_engine.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

/* Retry interval when a fragment could not be handed to the transport. */
#define KEEB_TX_RETRY_MS 20

/* Notification payload cap, excluding the keeb_notify header. */
#define KEEB_NOTIFY_MAX 24
#define KEEB_NOTIFY_ITEMS 4

/* --------------------------------------------------------------------------
 * State
 * -------------------------------------------------------------------------- */

static const struct keeb_tlv_tx_dev *tx_dev;

static struct keeb_tlv_rx rx = KEEB_TLV_RX_INIT;
static uint8_t tx_buf[KEEB_TLV_MSG_MAX];
static uint8_t tx_pkt[KEEB_PKT_HDR_SIZE + KEEB_TLV_FRAG_MAX];
static struct keeb_tlv_tx tx;

/* The reassembly slot is held from the moment a message completes until the
 * reply for it has been sent, because both buffers are reused, not copied.
 */
static bool rx_held;
static uint16_t rx_held_msg_id;
static uint16_t rx_msg_len; /* valid while rx_held */

/* What the engine work item still has to do. */
#define PENDING_DISPATCH BIT(0)
#define PENDING_ERR_ACK BIT(1)
#define PENDING_NOTIFY BIT(2)

static uint32_t pending;
static uint16_t err_ack_msg_id;
static uint8_t err_ack_code;

static uint16_t next_msg_id = 1; /* ids for messages we originate */
static uint16_t notify_seq;

struct notify_item {
	uint16_t event;
	uint16_t len;
	uint8_t data[KEEB_NOTIFY_MAX];
};

K_MSGQ_DEFINE(keeb_notify_queue, sizeof(struct notify_item), KEEB_NOTIFY_ITEMS, 4);

static void engine_work_run(struct k_work *work);
K_WORK_DELAYABLE_DEFINE(engine_work, engine_work_run);

/* --------------------------------------------------------------------------
 * Sending
 * -------------------------------------------------------------------------- */

static uint16_t pkt_msg_id(const uint8_t *pkt, uint16_t pkt_len)
{
	if (pkt_len < KEEB_PKT_HDR_SIZE) {
		return 0;
	}

	struct keeb_pkt_hdr hdr;

	keeb_pkt_hdr_get(pkt, &hdr);

	return hdr.msg_id;
}

static void schedule_work(void)
{
	k_work_reschedule(&engine_work, K_NO_WAIT);
}

static void schedule_retry(void)
{
	k_work_reschedule(&engine_work, K_MSEC(KEEB_TX_RETRY_MS));
}

/** Start a reply from the built message and pump it. Returns true when the
 * message went out completely, false when it is still in flight (the work item
 * keeps pumping) or was refused.
 */
static bool tx_send(struct keeb_tlv_msg *msg, uint16_t msg_id, uint8_t flags)
{
	if (tx.busy) {
		return false; /* a message is already in flight */
	}

	int err = keeb_tlv_tx_start(&tx, tx_dev, tx_pkt, sizeof(tx_pkt), tx_buf,
				    (uint16_t)msg->len, msg_id, flags);

	if (err < 0) {
		LOG_WRN("reply of %u bytes could not start (%d)", (uint16_t)msg->len, -err);
		return false;
	}

	/* One line per message this side puts on the wire, so a host-side trace and
	 * this one describe the same traffic.
	 */
	LOG_INF("tx msg %u: %u bytes flags 0x%02x", msg_id, (uint16_t)msg->len, flags);

	int r = keeb_tlv_tx_pump(&tx);

	if (r == 1) {
		LOG_DBG("tx msg %u: fragments still queued", msg_id);
		return false; /* remaining fragments go through the work item */
	}

	if (r < 0) {
		LOG_WRN("transport failed, %u byte message dropped", (uint16_t)msg->len);
	}

	if (tx.msg_id == rx_held_msg_id) {
		rx_held = false; /* request slot is free again */
	}

	return r == 0;
}

/** Called by the work item after an interrupted send finishes or fails, to
 * release the request slot if that message was the reply it was waiting for.
 */
static void tx_settle(void)
{
	if (!tx.busy && tx.msg_id == rx_held_msg_id) {
		rx_held = false;
	}
}

/* --------------------------------------------------------------------------
 * Dispatch
 * -------------------------------------------------------------------------- */

static void ack_ok(struct keeb_ack *ack, uint16_t detail, uint32_t extra)
{
	if (!ack) {
		return;
	}

	ack->status = KEEB_STATUS_OK;
	ack->err_code = KEEB_ERR_NONE;
	ack->detail = detail;
	ack->extra = extra;
}

static void ack_err(struct keeb_ack *ack, uint8_t err_code)
{
	if (!ack || ack->status == KEEB_STATUS_ERR) {
		return; /* the first failure is the one worth reporting */
	}

	ack->status = KEEB_STATUS_ERR;
	ack->err_code = err_code;
}

static void handle_sys(uint16_t type, const uint8_t *data, uint16_t len, struct keeb_tlv_msg *msg,
		       struct keeb_ack *ack)
{
	switch (type) {
	case KEEB_T_PING:
		/* The ACK is the pong. */
		return;

	case KEEB_T_INFO: {
		struct keeb_info info;

		keeb_keymap_info(&info);
		info.flags |= keeb_display_capabilities();

		if (keeb_tlv_rec_add_struct(msg, KEEB_T_INFO, &info, sizeof(info))) {
			ack_err(ack, KEEB_ERR_TOO_BIG);
		}

		return;
	}

	case KEEB_T_TOKENS: {
		/* Listing request. Payload is the token index to continue
		 * from; the header record answers with `next` (0xffff when
		 * complete), so the host loops without guessing sizes.
		 */
		uint16_t start = 0;

		if (len >= sizeof(uint16_t)) {
			start = (uint16_t)(data[0] | (data[1] << 8));
		}

		struct keeb_tokens_hdr *hdr = keeb_tlv_rec_add(msg, KEEB_T_TOKENS, sizeof(*hdr));

		if (!hdr) {
			ack_err(ack, KEEB_ERR_TOO_BIG);
			return;
		}

		uint16_t count = keeb_token_count();
		uint16_t listed = 0;
		uint16_t next = start;

		for (uint16_t id = start; id < count; id++) {
			const struct keeb_token *token = keeb_token_get(id);

			if (!token) {
				continue;
			}

			uint8_t name_len = (uint8_t)strlen(token->name);
			struct keeb_token_rec *rec = keeb_tlv_rec_add(
					msg, KEEB_T_TOKENS,
					(uint16_t)(sizeof(*rec) + name_len));

			if (!rec) {
				break; /* full; the host continues at `next` */
			}

			rec->token = id;
			rec->rsvd = 0;
			rec->name_len = name_len;
			rec->flags = keeb_token_ready(id) ? KEEB_TOKEN_F_READY : 0;
			memcpy(((uint8_t *)rec) + sizeof(*rec), token->name, name_len);

			listed++;
			next = (uint16_t)(id + 1);
		}

		hdr->next = (next < count) ? next : 0xffffu;
		hdr->count = listed;
		hdr->token_hash = keeb_token_hash();
		return;
	}

	case KEEB_T_TOKEN_PARAMS: {
		if (len < sizeof(uint16_t)) {
			ack_err(ack, KEEB_ERR_BAD_LEN);
			return;
		}

		uint16_t token = (uint16_t)(data[0] | (data[1] << 8));

		if (keeb_keymap_token_params(token, msg)) {
			ack_err(ack, KEEB_ERR_BEHAVIOR);
		}

		return;
	}

	default:
		ack_err(ack, KEEB_ERR_UNKNOWN_TYPE);
	}
}

static void handle_keymap(uint16_t type, const uint8_t *data, uint16_t len,
			  struct keeb_tlv_msg *msg, struct keeb_ack *ack)
{
	uint16_t detail = 0;
	bool reply_now = false; /* records already appended, nothing else to say */

	switch (type) {
	case KEEB_T_CELLS_GET: {
		if (len < 1) {
			ack_err(ack, KEEB_ERR_BAD_LEN);
			return;
		}

		int err = keeb_keymap_dump(data[0], msg);

		if (err) {
			ack_err(ack, (uint8_t)(-err));
		}

		return;
	}

	case KEEB_T_CELLS_SET: {
		uint16_t applied = 0;

		if (len < 1) {
			ack_err(ack, KEEB_ERR_BAD_LEN);
			return;
		}

		int err = keeb_keymap_set_cells(data, len, &applied);

		if (err) {
			ack_err(ack, (uint8_t)(-err));
			return;
		}

		detail = applied;

		struct keeb_cells_set_notify {
			uint8_t layer;
			uint16_t count;
		} __packed payload = { .layer = data[0], .count = applied };

		keeb_engine_notify(KEEB_EV_CELLS_SET, &payload, sizeof(payload));
		break;
	}

	case KEEB_T_SAVE: {
		int err = keeb_keymap_save();

		if (err) {
			ack_err(ack, (uint8_t)(-err));
		}

		return;
	}

	case KEEB_T_DISCARD: {
		int err = keeb_keymap_discard();

		if (err) {
			ack_err(ack, (uint8_t)(-err));
		}

		return;
	}

	case KEEB_T_RESET: {
		int err = keeb_keymap_reset();

		if (err) {
			ack_err(ack, (uint8_t)(-err));
		}

		return;
	}

	case KEEB_T_LAYERS_GET: {
		int err = keeb_keymap_layers(msg);

		if (err) {
			ack_err(ack, (uint8_t)(-err));
		}

		return;
	}

	case KEEB_T_LAYER_NAME_SET: {
		if (len < 1) {
			ack_err(ack, KEEB_ERR_BAD_LEN);
			return;
		}

		int err = keeb_keymap_set_name(data[0], (const char *)(data + 1),
					       (uint16_t)(len - 1));

		if (err) {
			ack_err(ack, (uint8_t)(-err));
		}

		return;
	}

	case KEEB_T_LAYER_MOVE: {
		if (len < 2) {
			ack_err(ack, KEEB_ERR_BAD_LEN);
			return;
		}

		int err = keeb_keymap_move(data[0], data[1]);

		if (err) {
			ack_err(ack, (uint8_t)(-err));
		}

		return;
	}

	case KEEB_T_LAYER_ADD: {
		uint8_t index = 0;
		int err = keeb_keymap_add(&index);

		if (err) {
			ack_err(ack, (uint8_t)(-err));
			return;
		}

		ack_ok(ack, index, 0);
		return;
	}

	case KEEB_T_LAYER_REMOVE: {
		if (len < 1) {
			ack_err(ack, KEEB_ERR_BAD_LEN);
			return;
		}

		int err = keeb_keymap_remove(data[0]);

		if (err) {
			ack_err(ack, (uint8_t)(-err));
		}

		return;
	}

	case KEEB_T_LAYER_RESTORE: {
		if (len < 2) {
			ack_err(ack, KEEB_ERR_BAD_LEN);
			return;
		}

		int err = keeb_keymap_restore(data[0], data[1]);

		if (err) {
			ack_err(ack, (uint8_t)(-err));
		}

		return;
	}

	case KEEB_T_APPLY_COMMIT:
	case KEEB_T_APPLY_CANCEL:
		/* Staged apply is the next phase. Named in the protocol so a
		 * host never invents a conflicting operation number.
		 */
		ack_err(ack, KEEB_ERR_NOT_SUPPORTED);
		return;

	default:
		ack_err(ack, KEEB_ERR_UNKNOWN_TYPE);
		return;
	}

	(void)reply_now;
	ack_ok(ack, detail, 0);
}

static void handle_display(uint16_t type, const uint8_t *data, uint16_t len,
			   struct keeb_tlv_msg *msg, struct keeb_ack *ack)
{
	switch (type) {
	case KEEB_T_DISPLAY_INFO: {
		/* Limits first, then the preset names: the configurator sizes its
		 * editor from the reply instead of hard-coding the firmware's
		 * capacities. */
		struct keeb_display_info info;

		keeb_display_info(&info);

		if (keeb_tlv_rec_add_struct(msg, KEEB_T_DISPLAY_INFO, &info, sizeof(info))) {
			ack_err(ack, KEEB_ERR_TOO_BIG);
			return;
		}

		if (keeb_display_names(msg)) {
			ack_err(ack, KEEB_ERR_TOO_BIG);
		}

		return;
	}

	case KEEB_T_DISPLAY_GET: {
		int err = keeb_display_dump(msg);

		if (err) {
			ack_err(ack, (uint8_t)(-err));
		}

		return;
	}

	case KEEB_T_DISPLAY_SET: {
		uint16_t applied = 0;
		int err = keeb_display_set_table(data, len, &applied);

		if (err) {
			ack_err(ack, (uint8_t)(-err));
			return;
		}

		struct keeb_display_set_notify {
			uint8_t count;
			uint8_t flags;
		} __packed payload = { .count = (uint8_t)applied,
				       .flags = keeb_display_dirty() ? KEEB_DISPLAY_F_DIRTY : 0 };

		keeb_engine_notify(KEEB_EV_DISPLAY_SET, &payload, sizeof(payload));

		ack_ok(ack, applied, 0);
		return;
	}

	case KEEB_T_WIDGET_SET: {
		int err = keeb_display_set_widget(data, len);

		if (err) {
			ack_err(ack, (uint8_t)(-err));
			return;
		}

		ack_ok(ack, 0, 0);
		return;
	}

	case KEEB_T_TEXT_SET: {
		int err = keeb_display_set_text(data, len);

		if (err) {
			ack_err(ack, (uint8_t)(-err));
			return;
		}

		if (len >= sizeof(struct keeb_text_slot)) {
			uint8_t slot = data[0];

			keeb_engine_notify(KEEB_EV_TEXT_SET, &slot, sizeof(slot));
		}

		ack_ok(ack, 0, 0);
		return;
	}

	case KEEB_T_VALUE_SET: {
		int err = keeb_display_set_value(data, len);

		if (err) {
			ack_err(ack, (uint8_t)(-err));
			return;
		}

		ack_ok(ack, 0, 0);
		return;
	}

	case KEEB_T_PRESET_SET: {
		int err = keeb_display_preset(data, len);

		if (err) {
			ack_err(ack, (uint8_t)(-err));
			return;
		}

		ack_ok(ack, 0, 0);
		return;
	}

	case KEEB_T_DISPLAY_SAVE: {
		int err = keeb_display_save();

		if (err) {
			ack_err(ack, (uint8_t)(-err));
			return;
		}

		keeb_engine_notify(KEEB_EV_DISPLAY_SAVED, NULL, 0);
		return;
	}

	case KEEB_T_DISPLAY_DISCARD: {
		int err = keeb_display_discard();

		if (err) {
			ack_err(ack, (uint8_t)(-err));
		}

		return;
	}

	case KEEB_T_DISPLAY_RESET: {
		int err = keeb_display_reset();

		if (err) {
			ack_err(ack, (uint8_t)(-err));
		}

		return;
	}

	case KEEB_T_DISPLAY_BLANK: {
		int err = keeb_display_blank();

		if (err) {
			ack_err(ack, (uint8_t)(-err));
		}

		return;
	}

	default:
		ack_err(ack, KEEB_ERR_UNKNOWN_TYPE);
		return;
	}
}

static void dispatch(uint16_t msg_id)
{
	struct keeb_tlv_msg msg;

	keeb_tlv_msg_init(&msg, tx_buf, sizeof(tx_buf));

	/* Record 0 is the ACK, filled once everything else has been built. That
	 * needs the codec to reserve a record rather than copy one at the end.
	 */
	struct keeb_ack *ack = keeb_tlv_rec_add(&msg, KEEB_T_ACK, sizeof(*ack));

	if (!ack) {
		LOG_ERR("reply buffer unusable");
		rx_held = false;
		return;
	}

	ack_ok(ack, 0, 0); /* optimistic: handlers downgrade it */
	ack->msg_id = msg_id;

	struct keeb_tlv_iter it;

	keeb_tlv_iter_init(&it, rx.buf, rx_msg_len);

	uint16_t records = 0;

	for (;;) {
		uint16_t type;
		const uint8_t *data;
		uint16_t data_len;

		int r = keeb_tlv_iter_next(&it, &type, &data, &data_len);

		if (r == 1) {
			break; /* end of message */
		}

		if (r < 0) {
			ack_err(ack, KEEB_ERR_BAD_LEN);
			break;
		}

		records++;

		LOG_DBG("rx msg %u: record 0x%04x (%u bytes)", msg_id, type, data_len);

		switch (type >> 12) {
		case KEEB_NS_SYS:
			handle_sys(type, data, data_len, &msg, ack);
			break;
		case KEEB_NS_KEYMAP:
			handle_keymap(type, data, data_len, &msg, ack);
			break;
		case KEEB_NS_DISPLAY:
			handle_display(type, data, data_len, &msg, ack);
			break;
		default:
			ack_err(ack, KEEB_ERR_UNKNOWN_TYPE);
			break;
		}
	}

	/* The answer this reply carries, logged with the request it answers: the
	 * host-side trace shows the same pair, which is what makes a refused write
	 * traceable from either end.
	 */
	LOG_INF("rx msg %u: %u record(s) -> ack status %u err 0x%02x detail %u", msg_id, records,
		ack->status, ack->err_code, ack->detail);

	if (!tx_send(&msg, msg_id, KEEB_PKT_F_REPLY)) {
		/* Still in flight (or refused). Keep the dispatch state until
		 * it settles: the message buffer is the only copy.
		 */
		if (tx.busy) {
			return;
		}

		LOG_WRN("reply for message %u could not be sent", msg_id);
		rx_held = false;
	}
}

/* --------------------------------------------------------------------------
 * Notifications
 * -------------------------------------------------------------------------- */

int keeb_engine_notify(uint16_t event, const void *data, uint16_t len)
{
	struct notify_item item;

	memset(&item, 0, sizeof(item));
	item.event = event;

	if (len > KEEB_NOTIFY_MAX) {
		len = KEEB_NOTIFY_MAX; /* documented truncation */
	}

	if (len && data) {
		memcpy(item.data, data, len);
	}

	item.len = len;

	if (k_msgq_put(&keeb_notify_queue, &item, K_NO_WAIT) != 0) {
		LOG_WRN("notification %u dropped, queue full", event);
		return -EBUSY;
	}

	pending |= PENDING_NOTIFY;
	schedule_work();

	return 0;
}

static void send_notify(struct notify_item *item)
{
	struct keeb_tlv_msg msg;

	keeb_tlv_msg_init(&msg, tx_buf, sizeof(tx_buf));

	uint8_t *p = keeb_tlv_rec_add(&msg, KEEB_T_NOTIFY,
					 (uint16_t)(sizeof(struct keeb_notify) + item->len));

	if (!p) {
		return;
	}

	struct keeb_notify *hdr = (struct keeb_notify *)p;

	hdr->event = item->event;
	hdr->seq = notify_seq++;

	memcpy(p + sizeof(*hdr), item->data, item->len);

	tx_send(&msg, next_msg_id++, KEEB_PKT_F_REPLY | KEEB_PKT_F_NOTIFY);
}

static void send_error_ack(uint16_t msg_id, uint8_t err_code)
{
	struct keeb_tlv_msg msg;

	keeb_tlv_msg_init(&msg, tx_buf, sizeof(tx_buf));

	struct keeb_ack *ack = keeb_tlv_rec_add(&msg, KEEB_T_ACK, sizeof(*ack));

	if (!ack) {
		return;
	}

	ack->msg_id = msg_id;
	ack->status = KEEB_STATUS_ERR;
	ack->err_code = err_code;
	ack->detail = 0;
	ack->extra = 0;

	LOG_WRN("err ack for msg %u: 0x%02x", msg_id, err_code);

	tx_send(&msg, msg_id, KEEB_PKT_F_REPLY);
}

/* --------------------------------------------------------------------------
 * Work item
 * -------------------------------------------------------------------------- */

static void engine_work_run(struct k_work *work)
{
	/* Bounded rounds, so a chatty host cannot park this item on the system
	 * work queue.
	 */
	for (int round = 0; round < 8; round++) {
		if (tx.busy) {
			int r = keeb_tlv_tx_pump(&tx);

			if (r == 1) {
				schedule_retry();
				return;
			}

			if (r < 0) {
				LOG_WRN("transport failed, message dropped");
			}

			tx_settle();
			continue;
		}

		if (!tx_dev) {
			/* No transport attached: nothing can be sent, and
			 * holding the request slot forever would be worse than
			 * dropping the reply.
			 */
			rx_held = false;
			pending = 0;
			return;
		}

		if (pending & PENDING_DISPATCH) {
			pending &= ~PENDING_DISPATCH;
			dispatch(rx_held_msg_id);
			continue;
		}

		if (pending & PENDING_ERR_ACK) {
			pending &= ~PENDING_ERR_ACK;
			send_error_ack(err_ack_msg_id, err_ack_code);
			continue;
		}

		if (pending & PENDING_NOTIFY) {
			struct notify_item item;

			if (k_msgq_get(&keeb_notify_queue, &item, K_NO_WAIT) == 0) {
				send_notify(&item);
				continue;
			}

			pending &= ~PENDING_NOTIFY;
			continue;
		}

		return; /* nothing left to do */
	}

	schedule_work();
}

/* --------------------------------------------------------------------------
 * Receiving
 * -------------------------------------------------------------------------- */

static void msg_ready(void *user, uint16_t msg_id, uint8_t flags, const uint8_t *msg, uint16_t len)
{
	ARG_UNUSED(user);
	ARG_UNUSED(flags);
	ARG_UNUSED(msg);

	rx_held = true;
	rx_held_msg_id = msg_id;
	rx_msg_len = len;
	pending |= PENDING_DISPATCH;

	schedule_work();
}

void keeb_engine_rx(const uint8_t *pkt, uint16_t pkt_len)
{
	if (rx_held) {
		/* The previous request is still owed a reply. Refusing here is
		 * what makes sharing the reassembly and reply buffers safe.
		 */
		err_ack_msg_id = pkt_msg_id(pkt, pkt_len);
		err_ack_code = KEEB_ERR_BUSY;
		pending |= PENDING_ERR_ACK;
		schedule_work();
		return;
	}

	int err = keeb_tlv_rx_feed(&rx, pkt, pkt_len, msg_ready, NULL);

	if (err < 0) {
		err_ack_msg_id = pkt_msg_id(pkt, pkt_len);
		err_ack_code = (uint8_t)(-err);
		pending |= PENDING_ERR_ACK;
		schedule_work();
	}
}

void keeb_engine_set_transport(const struct keeb_tlv_tx_dev *dev)
{
	tx_dev = dev;
}

bool keeb_engine_tx_ready(void)
{
	return tx_dev != NULL;
}

/* --------------------------------------------------------------------------
 * Layer state events
 * --------------------------------------------------------------------------
 * The configurator shows the live layer, so it has to hear about changes
 * instead of polling a keyboard that is also mid-typing.
 */

static int layer_state_listener(const zmk_event_t *eh)
{
	ARG_UNUSED(eh);

	if (!tx_dev) {
		return 0;
	}

	uint32_t state = zmk_keymap_layer_state();

	keeb_engine_notify(KEEB_EV_LAYER_STATE, &state, sizeof(state));

	return 0;
}

ZMK_LISTENER(keeb_engine, layer_state_listener);
ZMK_SUBSCRIPTION(keeb_engine, zmk_layer_state_changed);

static int keeb_engine_init(void)
{
	keeb_keymap_revert_init();

	LOG_INF("keeb config engine ready");

	return 0;
}

SYS_INIT(keeb_engine_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);
