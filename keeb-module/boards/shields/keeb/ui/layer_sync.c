/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Central half: tell the peripheral which layer's artwork to show.
 *
 * Two jobs:
 *   - push the active layer whenever it changes (&keeb_layer_art is a
 *     BEHAVIOR_LOCALITY_GLOBAL behaviour, so ZMK forwards it to the
 *     peripheral), together with the device this keyboard is connected to,
 *   - poll the split transport for the peer link state, because ZMK raises no
 *     central-side event when a peripheral connects. On the connect edge the
 *     current layer is pushed again, otherwise a peripheral that connects
 *     after boot would keep showing layer 0 art.
 */

#include <zephyr/device.h>
#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>

#include <zmk/behavior.h>
#include <zmk/display.h>
#include <zmk/endpoints.h>
#include <zmk/event_manager.h>
#include <zmk/events/endpoint_changed.h>
#include <zmk/events/layer_state_changed.h>
#include <zmk/events/position_state_changed.h>
#include <zmk/events/usb_conn_state_changed.h>
#include <zmk/keymap.h>
#include <zmk/matrix.h>
#include <zmk/split/bluetooth/service.h> /* ZMK_SPLIT_RUN_BEHAVIOR_DEV_LEN */
#include <zmk/split/transport/central.h>
#include <zmk/split/transport/types.h>

#if IS_ENABLED(CONFIG_ZMK_BLE)
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/hci.h>
#include <zephyr/bluetooth/hci_types.h>
#include <zephyr/net/buf.h>
#include <zephyr/sys/byteorder.h>

#include <zmk/ble.h>
#include <zmk/events/ble_active_profile_changed.h>
#endif

#include "keeb_ui.h"
#include "layer_sync.h"
#include "keeb_settings.h"
#include "wpm.h"
#include "../../../../display/keeb_peer_panel.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#if !DT_NODE_HAS_STATUS(DT_NODELABEL(layer_art), okay)
#error "CONFIG_KEEB_UI needs the layer_art behaviour node from keeb.dtsi"
#endif

#define LAYER_ART_NODE DT_NODELABEL(layer_art)
#define LAYER_ART_DEV DEVICE_DT_NAME(LAYER_ART_NODE)

/* The name is what the split transport carries, and the payload it travels in
 * has ZMK_SPLIT_RUN_BEHAVIOR_DEV_LEN bytes for it *including* the NUL - 8
 * characters. Longer is silently truncated and the peripheral refuses the
 * invocation with -EINVAL, which looks like "the feature does nothing". */
BUILD_ASSERT(sizeof(LAYER_ART_DEV) <= ZMK_SPLIT_RUN_BEHAVIOR_DEV_LEN,
	     "layer_art node name is too long for the split behaviour payload");

#if !DT_NODE_HAS_STATUS(DT_NODELABEL(uistat), okay)
#error "CONFIG_KEEB_UI needs the uistat behaviour node from keeb.dtsi"
#endif

#define UI_STAT_DEV DEVICE_DT_NAME(DT_NODELABEL(uistat))

BUILD_ASSERT(sizeof(UI_STAT_DEV) <= ZMK_SPLIT_RUN_BEHAVIOR_DEV_LEN,
	     "uistat node name is too long for the split behaviour payload");

static atomic_t peer_connected;

/* A panel push is a 9+ frame burst with no acknowledgement coming back (see
 * ui/panel_stream.h), and the connect edge fires it while the link is still
 * settling - which is how a frame gets lost and a table never lands. The table is
 * idempotent, so re-pushing costs one redraw.
 *
 * shortcut: 3 ticks is a guess, not a protocol; add a real ack from the
 * peripheral if a push is ever seen to need more than this. */
#define KEEB_PEER_PANEL_REPUSH 3

static uint8_t peer_panel_repush;

bool keeb_layer_sync_peer_connected(void) { return atomic_get(&peer_connected) != 0; }

uint8_t keeb_split_device_id(void) {
	struct zmk_endpoint_instance endpoint = zmk_endpoint_get_selected();

	switch (endpoint.transport) {
	case ZMK_TRANSPORT_USB:
		return KEEB_DEV_USB;
	case ZMK_TRANSPORT_BLE:
		/* Profiles are 0-based in ZMK and 1-based on the panel: "device 2"
		 * is the second profile, which is what OUT_TOG keys are named for. */
		return (endpoint.ble.profile_index < 0)
			       ? KEEB_DEV_NONE
			       : (uint8_t)(endpoint.ble.profile_index + 1);
	default:
		return KEEB_DEV_NONE;
	}
}

static void push_active_layer(void) {
	struct zmk_behavior_binding binding = {
		.param1 = zmk_keymap_highest_layer_active(),
		/* The same push carries the connected device to the right half:
		 * one split message, both readouts, no extra traffic. */
		.param2 = keeb_split_device_id(),
		.behavior_dev = LAYER_ART_DEV,
	};
	struct zmk_behavior_binding_event event = {
		.layer = zmk_keymap_highest_layer_active(),
		.position = ZMK_KEYMAP_LEN, /* not a real key press */
		.timestamp = k_uptime_get(),
		.source = ZMK_POSITION_STATE_CHANGE_SOURCE_LOCAL,
	};

	int err = zmk_behavior_invoke_binding(&binding, event, true);
	if (err < 0) {
		LOG_WRN("Failed to push layer artwork to the peripheral (%d)", err);
	}
}

#if IS_ENABLED(CONFIG_ZMK_BLE)
/* The signal, sampled on its own thread. One HCI Read_RSSI is a *synchronous*
 * command with a ten second timeout, and this must never run on the system work
 * queue: the split transport sends from there, and a stalled command queue holds
 * back every push. It also must not run inside push_stats(), because a stall that
 * long empties the WPM window before it is read. */
static atomic_t host_rssi = ATOMIC_INIT(KEEB_RSSI_INVALID);

#define RSSI_SAMPLE_MS 5000

/** One HCI Read_RSSI. Returns false when the link cannot be measured. */
static bool conn_rssi(struct bt_conn *conn, int8_t *out) {
	uint16_t handle;
	struct net_buf *buf;
	struct net_buf *rsp = NULL;
	struct bt_hci_cp_read_rssi *cp;
	struct bt_hci_rp_read_rssi *rp;

	if (bt_hci_get_conn_handle(conn, &handle) != 0) {
		return false;
	}

	buf = bt_hci_cmd_create(BT_HCI_OP_READ_RSSI, sizeof(*cp));
	if (!buf) {
		return false;
	}

	cp = net_buf_add(buf, sizeof(*cp));
	cp->handle = sys_cpu_to_le16(handle);

	if (bt_hci_cmd_send_sync(BT_HCI_OP_READ_RSSI, buf, &rsp) != 0) {
		net_buf_unref(buf);
		return false;
	}

	rp = (void *)rsp->data;
	*out = rp->rssi;
	net_buf_unref(rsp);

	return true;
}

/** Host link signal as 0-100 %, or KEEB_RSSI_INVALID when there is no BLE host.
 * -100 dBm reads as 0 %, -40 dBm (very close) as 100 %. */
static uint8_t sample_host_rssi(void) {
	const uint8_t device = keeb_split_device_id();
	struct bt_conn *conn;
	int8_t rssi;

	if (device == KEEB_DEV_NONE || device == KEEB_DEV_USB) {
		return KEEB_RSSI_INVALID;
	}

	conn = zmk_ble_active_profile_conn();

	if (!conn || !conn_rssi(conn, &rssi)) {
		return KEEB_RSSI_INVALID;
	}

	return (uint8_t)CLAMP(((int)rssi + 100) * 100 / 60, 0, 100);
}

static void rssi_thread(void *a, void *b, void *c) {
	ARG_UNUSED(a);
	ARG_UNUSED(b);
	ARG_UNUSED(c);

	while (true) {
		atomic_set(&host_rssi, (int)sample_host_rssi());
		k_sleep(K_MSEC(RSSI_SAMPLE_MS));
	}
}

/* Low priority: it blocks for as long as the controller takes to answer, and
 * nothing else on this half waits for it. */
K_THREAD_DEFINE(keeb_rssi_tid, 1536, rssi_thread, NULL, NULL, NULL, K_PRIO_PREEMPT(12), 0, 0);
#endif /* CONFIG_ZMK_BLE */

static uint8_t host_rssi_percent(void) {
#if IS_ENABLED(CONFIG_ZMK_BLE)
	return (uint8_t)atomic_get(&host_rssi);
#else
	return KEEB_RSSI_INVALID;
#endif
}

/** The numbers only this half can produce, in one push per poll tick. Keeps the
 * 16-bit packing in sync with behavior_ui_stat.c. */
static void push_stats(void) {
	static uint8_t last_wpm = 0xff;
	static uint32_t last_packed;
	static bool pushed_once;

#if IS_ENABLED(CONFIG_ZMK_BLE)
	const int profile = zmk_ble_active_profile_index();
	const uint8_t active =
		(profile < 0 || profile >= ZMK_BLE_PROFILE_COUNT) ? KEEB_PROFILE_NONE
								  : (uint8_t)profile;
	const uint8_t count = MIN(ZMK_BLE_PROFILE_COUNT, 0xff);
#else
	const uint8_t active = KEEB_PROFILE_NONE;
	const uint8_t count = 0;
#endif

	const uint8_t wpm = keeb_wpm_value();
	const uint32_t packed =
		(uint32_t)active | ((uint32_t)count << 8) | ((uint32_t)host_rssi_percent() << 16);

	/* A panel refresh on the other half costs a 1-bit screen update, so an
	 * idle keyboard sends nothing at all. */
	if (pushed_once && wpm == last_wpm && packed == last_packed) {
		return;
	}

	pushed_once = true;
	last_wpm = wpm;
	last_packed = packed;

	struct zmk_behavior_binding binding = {
		.param1 = wpm,
		.param2 = packed,
		.behavior_dev = UI_STAT_DEV,
	};
	struct zmk_behavior_binding_event event = {
		.layer = zmk_keymap_highest_layer_active(),
		.position = ZMK_KEYMAP_LEN,
		.timestamp = k_uptime_get(),
		.source = ZMK_POSITION_STATE_CHANGE_SOURCE_LOCAL,
	};

	/* What actually went out. The one line to look at when the right half
	 * shows a zero: it says whether the rate was counted here. */
	LOG_DBG("ui stat push: wpm=%u packed=0x%06x", wpm, packed);

	int err = zmk_behavior_invoke_binding(&binding, event, true);
	if (err < 0) {
		LOG_WRN("Failed to push panel stats to the peripheral (%d)", err);
	}
}

static void check_peer(void) {
	bool connected = false;

	STRUCT_SECTION_FOREACH(zmk_split_transport_central, transport) {
		if (!transport->api || !transport->api->get_status) {
			continue;
		}

		struct zmk_split_transport_status status = transport->api->get_status();

		if (status.available &&
		    status.connections != ZMK_SPLIT_TRANSPORT_CONNECTIONS_STATUS_DISCONNECTED) {
			connected = true;
		}
	}

	const bool was_connected = atomic_set(&peer_connected, connected) != 0;

	if (was_connected != connected) {
		/* The link indicator on the left panel reads this value. */
		keeb_ui_request_draw();
	}

	if (!connected) {
		peer_panel_repush = 0;
	}

	if (connected && !was_connected) {
		push_active_layer();

#if IS_ENABLED(CONFIG_KEEB_SETTINGS)
		/* The same edge, for the same reason: a half that connects after the
		 * host changed the timeouts would otherwise keep its own numbers.  The
		 * push carries the persistence state the central is actually in - saved,
		 * applied-but-unsaved, or never touched - so the central stays the one
		 * the two halves agree with. */
		keeb_settings_relay(keeb_settings_dirty() ? KEEB_RELAY_APPLY : KEEB_RELAY_DISCARD);
#endif

		/* And the other half's panel table: the peripheral boots with its
		 * compiled-in preset, so a link that comes up after a host edited it
		 * has to be taught the saved look. */
		keeb_peer_panel_push();
		peer_panel_repush = KEEB_PEER_PANEL_REPUSH;
	}
}

static void poll_work_cb(struct k_work *work) {
	ARG_UNUSED(work);
	check_peer();

	/* Sample the rate every tick, connected or not: the window is time based, so
	 * reading it only when there is somewhere to push to would leave one long
	 * gap and blank the whole window on the first push after the link returns. */
	(void)keeb_wpm_value();

	/* One push per poll tick. The WPM window in wpm.c assumes a 1 s tick,
	 * so CONFIG_KEEB_UI_LAYER_SYNC_POLL_MS is the knob that keeps both
	 * halves' rate readouts meaningful. */
	if (keeb_layer_sync_peer_connected()) {
		/* Same reason as the connect edge above: this burst is the one most
		 * likely to lose a frame, so it gets more than one attempt. */
		if (peer_panel_repush) {
			peer_panel_repush--;
			keeb_peer_panel_push();
		}

		push_stats();
	}
}

static K_WORK_DEFINE(poll_work, poll_work_cb);

static void poll_timer_fn(struct k_timer *timer) {
	ARG_UNUSED(timer);
	k_work_submit(&poll_work);
}

K_TIMER_DEFINE(poll_timer, poll_timer_fn, NULL);

static int layer_changed_cb(const zmk_event_t *eh) {
	ARG_UNUSED(eh);
	push_active_layer();
	return 0;
}

ZMK_LISTENER(keeb_layer_sync, layer_changed_cb);
ZMK_SUBSCRIPTION(keeb_layer_sync, zmk_layer_state_changed);
ZMK_SUBSCRIPTION(keeb_layer_sync, zmk_endpoint_changed);
ZMK_SUBSCRIPTION(keeb_layer_sync, zmk_usb_conn_state_changed);
#if IS_ENABLED(CONFIG_ZMK_BLE)
ZMK_SUBSCRIPTION(keeb_layer_sync, zmk_ble_active_profile_changed);
#endif

static int keeb_layer_sync_init(void) {
	k_timer_start(&poll_timer, K_MSEC(CONFIG_KEEB_UI_LAYER_SYNC_POLL_MS),
		      K_MSEC(CONFIG_KEEB_UI_LAYER_SYNC_POLL_MS));
	return 0;
}

SYS_INIT(keeb_layer_sync_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);
