/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * BLE GATT transport for the KEEB TLV config channel.
 *
 * A vendor service with two characteristics:
 *
 *   cmd  - write without response, host -> keyboard
 *   evt  - notify, keyboard -> host
 *
 * Write without response is a deliberate choice. A write *request* needs a
 * response per fragment, and prepared (long) writes would make the firmware
 * reassemble at the ATT layer instead of the protocol layer. With a 46 byte
 * fragment payload (CONFIG_BT_L2CAP_TX_MTU = 65, minus 3 for the ATT opcode and
 * handle, minus the 16 byte KEEB packet header that travels *inside* the
 * notification) a 960 byte layout dump is ~21 fragments, and that is worth
 * doing in the protocol, where the sender learns what happened. It also means a
 * lost fragment is normal: the protocol's ACK/timeout restart covers it, which
 * is why reassembly is offset-based with an in-order rule (keeb_tlv.h).
 *
 * Permissions require encryption. The keyboard already encrypts its link to the
 * host: ZMK declares the HID report characteristics READ_ENCRYPT
 * (zmk/app/src/hog.c), so an unpaired host cannot even read the report map,
 * while WRITE_ENCRYPT costs nothing and stops a stranger on the air from
 * rewriting a layout.
 *
 * WRITE_ENCRYPT alone is not enough to make a session work, because Zephyr does
 * not start pairing when a write arrives on an encrypted attribute:
 * bt_gatt_check_perm() simply answers Insufficient Authentication (no bond) or
 * Insufficient Encryption (bonded, link not encrypted). So this transport asks
 * for security itself, when a host subscribes to the notify characteristic -
 * the one act that proves the peer is a configurator and not the other half of
 * the split. Pairing is still ZMK's decision (zmk/app/src/ble.c
 * auth_pairing_accept refuses a taken profile), and CONFIG_BT_SMP_SC_PAIR_ONLY
 * means only LE Secure Connections pairing is accepted.
 *
 * The service is declared with BT_GATT_SERVICE_DEFINE, which appends to
 * Zephyr's static attribute table. ZMK's HID service is untouched, and clients
 * discover this one by UUID rather than by handle numbers - the notify attribute
 * is located by UUID here for the same reason.
 */

#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/uuid.h>
#include <zephyr/init.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>
#include <zephyr/sys/util.h>

#include <errno.h>
#include <string.h>

#include "../engine/keeb_engine.h"
#include "../proto/keeb_tlv.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

/* Vendor UUIDs. The leading 4b454542 is "KEEB" and the tail spells KEBTLV, so
 * the service identifies itself in a GATT dump instead of being an opaque
 * number. Fixed and project-owned: the configurator hard-codes them.
 */
/* BT_UUID_128_ENCODE wants its five groups as five arguments, with the byte
 * order Zephyr's own convention (w32-w1-w2-w3-w48), so the argument list is
 * written where the commas can be seen by the preprocessor. Same shape as
 * zmk/app/include/zmk/split/bluetooth/uuid.h.
 */
#define KEEB_TLV_UUID(num) BT_UUID_128_ENCODE(0x4b454542, 0x0000, num, 0x9c41, 0x4b4542544c56)

static const struct bt_uuid_128 keeb_svc_uuid = BT_UUID_INIT_128(KEEB_TLV_UUID(0x0001));
static const struct bt_uuid_128 keeb_cmd_uuid = BT_UUID_INIT_128(KEEB_TLV_UUID(0x0002));
static const struct bt_uuid_128 keeb_evt_uuid = BT_UUID_INIT_128(KEEB_TLV_UUID(0x0003));

/* ATT overhead around a notification: opcode + attribute handle. */
#define KEEB_BLE_ATT_OVERHEAD 3

/* Fragment payload. The notification payload is a whole KEEB packet - 16 byte
 * header plus fragment - so the ATT overhead is not the only thing the MTU has
 * to pay for. Getting this wrong is not a soft failure: bt_att_create_pdu()
 * refuses a PDU larger than the negotiated MTU, bt_gatt_notify() reports it as
 * -ENOMEM ("No buffer available to send notification"), and the codec reads
 * that as a full TX pool and retries the same oversized fragment forever.
 */
#define KEEB_BLE_MAX_FRAG (CONFIG_BT_L2CAP_TX_MTU - KEEB_BLE_ATT_OVERHEAD - KEEB_PKT_HDR_SIZE)

BUILD_ASSERT(KEEB_BLE_MAX_FRAG >= KEEB_TLV_FRAG_MIN,
	     "CONFIG_BT_L2CAP_TX_MTU leaves no room for KEEB packets: the header is 16 "
	     "bytes and the sender will not go below KEEB_TLV_FRAG_MIN payload bytes");

static const struct bt_gatt_attr *evt_attr; /* notify value attribute */
static atomic_t host_subscribed;

/* A link is a configurator link when it has subscribed to the KEEB notify
 * characteristic. Subscription is per-connection in Zephyr (the CCC is
 * host-managed: bt_gatt_attr_read_ccc answers from the cfg entry belonging to
 * this peer), which is what makes this test able to tell a host from the split
 * peer - a role check cannot, because on the peripheral half both links are
 * peripheral-role.
 */
static bool keeb_is_config_link(struct bt_conn *conn)
{
	struct bt_conn_info info;

	bt_conn_get_info(conn, &info);

	if (info.state != BT_CONN_STATE_CONNECTED) {
		return false;
	}

	return bt_gatt_is_subscribed(conn, evt_attr, BT_GATT_CCC_NOTIFY);
}

/* Ask the peer to pair, on the links that asked for KEEB notifications.
 * BT_SECURITY_L2 is "encrypted", which is exactly what WRITE_ENCRYPT needs;
 * ZMK's SMP settings then decide the rest (SC-only, and no pairing onto a
 * profile another host already holds). -EALREADY just means the link is already
 * at that level, which is the normal case on a reconnect to a bonded host.
 */
static void keeb_request_security(struct bt_conn *conn, void *user_data)
{
	ARG_UNUSED(user_data);

	if (!keeb_is_config_link(conn)) {
		return;
	}

	if (bt_conn_get_security(conn) >= BT_SECURITY_L2) {
		return;
	}

	int err = bt_conn_set_security(conn, BT_SECURITY_L2);

	if (err == 0) {
		LOG_INF("keeb tlv: pairing requested on the config link");
		return;
	}

	if (err != -EALREADY) {
		LOG_WRN("keeb tlv: security request failed (%d)", err);
	}
}

static void cccd_changed(const struct bt_gatt_attr *attr, uint16_t value)
{
	ARG_UNUSED(attr);

	host_subscribed = (value == BT_GATT_CCC_NOTIFY) ? 1 : 0;

	LOG_INF("keeb tlv channel %s", host_subscribed ? "subscribed" : "unsubscribed");

	/* Subscribing is the host saying "I am here to configure". From here on
	 * its writes have to be encrypted, so start the pairing now instead of
	 * letting the first command fail. bt_conn_set_security only queues SMP
	 * work, so running it from the ATT callback is fine.
	 */
	if (host_subscribed && IS_ENABLED(CONFIG_BT_SMP)) {
		bt_conn_foreach(BT_CONN_TYPE_LE, keeb_request_security, NULL);
	}
}

static ssize_t cmd_write(struct bt_conn *conn, const struct bt_gatt_attr *attr, const void *buf,
			 uint16_t len, uint16_t offset, uint8_t flags)
{
	ARG_UNUSED(conn);
	ARG_UNUSED(attr);
	ARG_UNUSED(flags);

	/* Write without response delivers a complete packet, so there is no
	 * offset case to merge. Anything else is a host not following the
	 * protocol, and refusing it beats accepting a torn packet.
	 */
	if (offset != 0 || len < KEEB_PKT_HDR_SIZE) {
		LOG_WRN("keeb tlv write refused: offset %u len %u", offset, len);
		return BT_GATT_ERR(BT_ATT_ERR_INVALID_OFFSET);
	}

	keeb_engine_rx(buf, len);

	return len;
}

BT_GATT_SERVICE_DEFINE(keeb_tlv_svc,
		       BT_GATT_PRIMARY_SERVICE(&keeb_svc_uuid),
		       BT_GATT_CHARACTERISTIC(&keeb_cmd_uuid.uuid,
					      BT_GATT_CHRC_WRITE_WITHOUT_RESP,
					      BT_GATT_PERM_WRITE_ENCRYPT, NULL, cmd_write, NULL),
		       BT_GATT_CHARACTERISTIC(&keeb_evt_uuid.uuid, BT_GATT_CHRC_NOTIFY,
					      BT_GATT_PERM_NONE, NULL, NULL, NULL),
		       BT_GATT_CCC(cccd_changed, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE));

/* Find the notify characteristic's *value* attribute. The declaration
 * attribute has type BT_UUID_GATT_CHRC and only carries the UUID in its value,
 * so comparing the attribute type UUID (not the value) is what distinguishes
 * them. Looking it up instead of hard-coding an index keeps this correct when
 * the attribute table moves under us - which is exactly what a ZMK or Zephyr
 * rebase does.
 */
static int find_notify_attr(void)
{
	for (size_t i = 0; i < ARRAY_SIZE(attr_keeb_tlv_svc); i++) {
		if (attr_keeb_tlv_svc[i].uuid == (const struct bt_uuid *)&keeb_evt_uuid) {
			evt_attr = &attr_keeb_tlv_svc[i];
			return 0;
		}
	}

	return -ENODEV;
}

/* One send attempt across the links that asked for KEEB notifications. */
struct keeb_notify_ctx {
	const uint8_t *pkt;
	uint16_t pkt_len;
	bool delivered; /* at least one configurator link took this fragment */
	bool mtu_short; /* a peer's ATT MTU cannot carry this packet */
	int err;        /* first failure, as a positive errno */
};

static void keeb_notify_conn(struct bt_conn *conn, void *user_data)
{
	struct keeb_notify_ctx *ctx = user_data;

	if (!keeb_is_config_link(conn)) {
		return;
	}

	uint16_t mtu = bt_gatt_get_mtu(conn);

	/* The notification PDU is opcode + handle + the whole KEEB packet. */
	if (mtu != 0u && (uint16_t)(ctx->pkt_len + KEEB_BLE_ATT_OVERHEAD) > mtu) {
		ctx->mtu_short = true;
		return;
	}

	int err = bt_gatt_notify(conn, evt_attr, ctx->pkt, ctx->pkt_len);

	if (err == 0) {
		ctx->delivered = true;
		return;
	}

	if (ctx->err == 0) {
		ctx->err = -err;
	}
}

static int tx_send(void *user, const uint8_t *pkt, uint16_t pkt_len)
{
	ARG_UNUSED(user);

	if (!atomic_get(&host_subscribed)) {
		/* Nobody is listening. Dropping is right, not lazy: a host that
		 * has not subscribed has not asked for these messages, and it
		 * will ask again after subscribing.
		 */
		return KEEB_TX_FAIL;
	}

	struct keeb_notify_ctx ctx = {
		.pkt = pkt,
		.pkt_len = pkt_len,
	};

	bt_conn_foreach(BT_CONN_TYPE_LE, keeb_notify_conn, &ctx);

	/* Checked before sending, not after: bt_gatt_notify reports an
	 * oversized PDU as -ENOMEM, which is indistinguishable from an empty TX
	 * pool, and the codec's answer to -ENOMEM is "retry the same fragment
	 * later" - a loop that cannot end. A size the peer's MTU cannot carry is
	 * KEEB_TX_MTU, which makes the codec halve the fragment instead.
	 */
	if (ctx.mtu_short) {
		return KEEB_TX_MTU;
	}

	if (ctx.delivered) {
		return 0;
	}

	if (ctx.err == 0) {
		/* The subscription flag is set but no live link holds it: the
		 * host is gone. Let the host restart the message.
		 */
		return KEEB_TX_FAIL;
	}

	switch (ctx.err) {
	case ENOMEM:
	case EBUSY:
	case EAGAIN:
		/* Bluetooth TX context pool empty. This fragment goes again
		 * later, unchanged.
		 */
		return KEEB_TX_BUSY;

	case EMSGSIZE:
	case EOVERFLOW:
		/* The peer negotiated a smaller MTU than advertised. The codec
		 * shrinks the fragment and re-sends the same offset.
		 */
		return KEEB_TX_MTU;

	default:
		/* -ENOTSUP (no subscription left), a dropped connection, or
		 * anything unforeseen: stop, and let the host restart the
		 * message. Half a layout arriving is worse than none.
		 */
		LOG_DBG("keeb tlv notify failed (%d)", -ctx.err);
		return KEEB_TX_FAIL;
	}
}

static const struct keeb_tlv_tx_dev ble_tx_dev = {
	.send = tx_send,
	.user = NULL,
	.max_frag = KEEB_BLE_MAX_FRAG,
};
static int keeb_ble_transport_register(void)
{
	int err = find_notify_attr();

	if (err) {
		LOG_ERR("keeb tlv notify attribute not found");
		return err;
	}

	keeb_engine_set_transport(&ble_tx_dev);

	LOG_INF("keeb tlv: GATT channel ready, %u byte fragments", KEEB_BLE_MAX_FRAG);

	return 0;
}

/* No runtime service registration: BT_GATT_SERVICE_DEFINE is a static table
 * entry, so this only hands the engine its send hook and resolves the notify
 * attribute.
 *
 * Same init level as the engine on purpose. Registering is order-independent
 * here - the notify attribute is a static GATT table, and the transport hook
 * is a pointer the engine only reads when it has a reply to send - and
 * CONFIG_APPLICATION_INIT_PRIORITY + 1 is not: it steps past Zephyr's init
 * level limit, which the linker reports as "Undefined initialization levels
 * used." rather than as a Kconfig error.
 */
SYS_INIT(keeb_ble_transport_register, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);
