/*
 * zmk-status-led - three-channel (RGB) status LED for ZMK keyboards.
 * Each channel is a Zephyr LED device reached by phandle from the
 * 'zmk,status-led' node: a 'gpio-leds' child (a KY-016 on plain SoC GPIOs or
 * on a GPIO expander) is on/off only, a 'pwm-leds' child (an nRF52 PWM
 * output) is a real duty cycle. The driver is identical for both - it asks
 * for a brightness percentage per channel and Zephyr's LED driver turns that
 * into a pin state or a pulse width.
 *
 * Brightness: CONFIG_ZMK_STATUS_LED_BRIGHTNESS_PERCENT (default 50) is the
 * level used for every lit signal, so the palette keeps its proportions and
 * the whole thing dims together. A GPIO channel cannot honor it; the driver
 * says so once at boot rather than silently running full on.
 *
 * Palette (priority order):
 *   ERROR   - solid red; battery <= CONFIG_ZMK_STATUS_LED_BATTERY_ERROR_LEVEL,
 *             latched until the level recovers by 5% (hysteresis)
 *   LAYER   - solid color chosen by the keyboard via
 *             zmk_status_led_set_layer_color() (see include/zmk/status_led.h);
 *             overrides FLASH/ADV while active, ERROR still wins
 *   FLASH   - one 150 ms green flash; BLE profile connected (also on switch)
 *   ADV     - slow periodic blue pulse while not connected / advertising
 *   BOOT    - N quick white blinks at startup, then FLASH/ADV/ERROR
 *   OFF     - default (all channels off); forced off in the SLEEP activity state
 *
 * Fully asynchronous: all timing runs on a delayable work item, nothing
 * ever sleeps the system workqueue. Works on split centrals and split
 * peripherals (peripherals track their connection to the central).
 */

#include <zephyr/kernel.h>
#include <zephyr/init.h>
#include <zephyr/device.h>
#include <zephyr/drivers/led.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/logging/log.h>

#include <zmk/activity.h>
#include <zmk/battery.h>
#include <zmk/ble.h>
#include <zmk/event_manager.h>
#include <zmk/events/activity_state_changed.h>
#include <zmk/events/battery_state_changed.h>
#include <zmk/events/ble_active_profile_changed.h>

#include <zmk/status_led.h>

#if defined(CONFIG_ZMK_SPLIT) && !defined(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
#include <zmk/split/bluetooth/peripheral.h>
#endif

LOG_MODULE_REGISTER(zmk_status_led, CONFIG_ZMK_LOG_LEVEL);

#define DT_DRV_COMPAT zmk_status_led

#if !DT_HAS_COMPAT_STATUS_OKAY(DT_DRV_COMPAT)
#error "Enable CONFIG_ZMK_STATUS_LED only with a 'zmk,status-led' devicetree node (see module README)"
#endif

#define LED_R_NODE DT_PHANDLE(DT_INST(0, zmk_status_led), led_r)
#define LED_G_NODE DT_PHANDLE(DT_INST(0, zmk_status_led), led_g)
#define LED_B_NODE DT_PHANDLE(DT_INST(0, zmk_status_led), led_b)
static const struct led_dt_spec led_r = LED_DT_SPEC_GET(LED_R_NODE);
static const struct led_dt_spec led_g = LED_DT_SPEC_GET(LED_G_NODE);
static const struct led_dt_spec led_b = LED_DT_SPEC_GET(LED_B_NODE);

/* Whether the channels are dimmable is decided by the devicetree (pwm-leds vs
 * gpio-leds children), not by a Kconfig option - the wiring is where that is
 * known. Only the R channel is checked: a build that mixes the two is not a
 * wiring this module documents, and the log line is diagnostic either way. */
#define LED_CHANNELS_ARE_PWM DT_NODE_HAS_COMPAT(LED_R_NODE, pwm_leds)

#define LED_ON_PCT CONFIG_ZMK_STATUS_LED_BRIGHTNESS_PERCENT

#define BOOT_ON_MS 100
#define BOOT_OFF_MS 100
#define FLASH_ON_MS 150
#define ADV_ON_MS CONFIG_ZMK_STATUS_LED_ADV_PULSE_MS
#define ADV_PERIOD_MS CONFIG_ZMK_STATUS_LED_ADV_PERIOD_MS
#define ERROR_CLEAR_HYSTERESIS 5 /* % above latch threshold that clears the error */

enum led_mode { MODE_OFF, MODE_BOOT, MODE_FLASH, MODE_ADV, MODE_ERROR, MODE_LAYER };

static enum led_mode mode = MODE_OFF;
static enum zmk_status_led_color layer_color = ZMK_STATUS_LED_COLOR_OFF;
static bool suspended;      /* ZMK activity state is SLEEP */
static bool connected;      /* profile (central) or central (peripheral) connected */
static bool error_latched;  /* battery below threshold */
static uint8_t step;        /* pattern step counter for the current mode */

static void tick(struct k_work *work);
static K_WORK_DELAYABLE_DEFINE(led_tick, tick);

/* All three channels in one shot (one LED driver call per channel; on a
 * PWM-backed board each one is a duty-cycle write to its PWM instance -
 * cheap at blink rates, and bus-serialized with the kscan if they live on an
 * expander).
 *
 * ON is LED_ON_PCT percent, OFF is 0%: on a `pwm-leds` channel 0% and 100%
 * both make the driver stop the PWM peripheral and hold the pad, so only a
 * dimmed signal keeps the peripheral running. Called from the tick work only,
 * never from an ISR. */
static inline void led_channel(const struct led_dt_spec *led, bool on) {
	uint8_t pct = on ? LED_ON_PCT : 0;
	int ret = led_set_brightness_dt(led, pct);

	if (ret < 0) {
		LOG_WRN("status LED %s[%u] -> %u%% failed (%d)", led->dev->name, led->index, pct, ret);
	}
}

static inline void led_rgb(bool r, bool g, bool b) {
	led_channel(&led_r, r);
	led_channel(&led_g, g);
	led_channel(&led_b, b);
}

static void enter(enum led_mode m) {
	mode = m;
	step = 0;
	k_work_schedule(&led_tick, K_NO_WAIT);
}

/* Recompute the LED mode from current flags; used after any flag change. */
static void reevaluate(void) {
	if (suspended) {
		return;
	}
	if (error_latched) {
		enter(MODE_ERROR);
	} else if (layer_color != ZMK_STATUS_LED_COLOR_OFF) {
		enter(MODE_LAYER);
	} else if (connected) {
		enter(MODE_FLASH);
	} else {
		enter(MODE_ADV);
	}
}

void zmk_status_led_set_layer_color(enum zmk_status_led_color color) {
	if (color == layer_color) {
		return;
	}
	layer_color = color;
	/* During boot blinks or sleep just record it; BOOT end and the
	 * wake path both reevaluate(). */
	if (mode != MODE_BOOT && !suspended) {
		reevaluate();
	}
}

static void tick(struct k_work *work) {
	switch (mode) {
	case MODE_ERROR:
		led_rgb(true, false, false); /* solid red */
		/* solid: no reschedule; re-entered on recovery/wake via reevaluate() */
		return;

	case MODE_LAYER:
		switch (layer_color) {
		case ZMK_STATUS_LED_COLOR_RED:
			led_rgb(true, false, false);
			break;
		case ZMK_STATUS_LED_COLOR_GREEN:
			led_rgb(false, true, false);
			break;
		case ZMK_STATUS_LED_COLOR_BLUE:
			led_rgb(false, false, true);
			break;
		default: /* OFF: reevaluate() should have left this mode already */
			break;
		}
		/* solid: no reschedule; re-entered on color change via reevaluate() */
		return;

	case MODE_OFF:
		led_rgb(false, false, false);
		return;

	case MODE_BOOT: {
		bool on = (step & 1) == 0;
		led_rgb(on, on, on); /* white */
		step++;
		if (step < CONFIG_ZMK_STATUS_LED_BOOT_BLINKS * 2) {
			k_work_schedule(&led_tick, K_MSEC((step & 1) ? BOOT_OFF_MS : BOOT_ON_MS));
		} else {
			reevaluate();
		}
		return;
	} /* MODE_BOOT */

	case MODE_FLASH:
		led_rgb(false, step == 0, false); /* one green flash */
		step++;
		if (step == 1) {
			k_work_schedule(&led_tick, K_MSEC(FLASH_ON_MS));
		} else {
			enter(MODE_OFF);
		}
		return;

	case MODE_ADV:
#if defined(CONFIG_ZMK_SPLIT) && !defined(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
		/* Peripherals have no profile events; poll the central link. */
		if (zmk_split_bt_peripheral_is_connected()) {
			connected = true;
			enter(MODE_FLASH);
			return;
		}
#endif
		led_rgb(false, false, step == 0); /* blue pulse */
		step ^= 1;
		k_work_schedule(&led_tick, K_MSEC(step ? ADV_ON_MS : ADV_PERIOD_MS - ADV_ON_MS));
		return;
	}
}

/* --- BLE connection callbacks (central and non-split builds) ------------- */

static void ble_connected(struct bt_conn *conn, uint8_t err) {
	if (err) {
		LOG_WRN("connection failed: %u", err);
		return;
	}
	connected = true;
	/* During boot blinks just record it; BOOT end transitions to FLASH. */
	if (mode != MODE_BOOT) {
		reevaluate();
	}
}

static void ble_disconnected(struct bt_conn *conn, uint8_t reason) {
	connected = false;
	if (mode != MODE_BOOT) {
		reevaluate();
	}
}

static struct bt_conn_cb conn_callbacks = {
	.connected = ble_connected,
	.disconnected = ble_disconnected,
};

/* --- ZMK event listeners -------------------------------------------------- */

#if !defined(CONFIG_ZMK_SPLIT) || defined(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
static int profile_changed_listener(const zmk_event_t *eh) {
	if (as_zmk_ble_active_profile_changed(eh) == NULL) {
		return ZMK_EV_EVENT_BUBBLE;
	}
	bool now = zmk_ble_active_profile_is_connected();
	if (now != connected) {
		connected = now;
		if (mode != MODE_BOOT) {
			reevaluate();
		}
	}
	return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(status_led_profile, profile_changed_listener);
ZMK_SUBSCRIPTION(status_led_profile, zmk_ble_active_profile_changed);
#endif

static int battery_changed_listener(const zmk_event_t *eh) {
	if (as_zmk_battery_state_changed(eh) == NULL) {
		return ZMK_EV_EVENT_BUBBLE;
	}
	int level = zmk_battery_state_of_charge();

	if (!error_latched && level <= CONFIG_ZMK_STATUS_LED_BATTERY_ERROR_LEVEL) {
		error_latched = true;
		if (mode != MODE_BOOT) {
			reevaluate();
		}
	} else if (error_latched && level > CONFIG_ZMK_STATUS_LED_BATTERY_ERROR_LEVEL + ERROR_CLEAR_HYSTERESIS) {
		error_latched = false;
		if (mode != MODE_BOOT) {
			reevaluate();
		}
	}
	return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(status_led_battery, battery_changed_listener);
ZMK_SUBSCRIPTION(status_led_battery, zmk_battery_state_changed);

static int activity_changed_listener(const zmk_event_t *eh) {
	const struct zmk_activity_state_changed *ev = as_zmk_activity_state_changed(eh);
	if (ev == NULL) {
		return ZMK_EV_EVENT_BUBBLE;
	}
	if (ev->state == ZMK_ACTIVITY_SLEEP) {
		suspended = true;
		k_work_cancel_delayable(&led_tick);
		led_rgb(false, false, false);
	} else if (suspended) {
		suspended = false;
		reevaluate();
	}
	return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(status_led_activity, activity_changed_listener);
ZMK_SUBSCRIPTION(status_led_activity, zmk_activity_state_changed);

/* --- init ------------------------------------------------------------------ */

static int status_led_init(void) {
	static const struct led_dt_spec *const chans[] = {&led_r, &led_g, &led_b};

	for (size_t i = 0; i < ARRAY_SIZE(chans); i++) {
		if (!led_is_ready_dt(chans[i])) {
			LOG_ERR("status LED channel %zu: LED device %s not ready", i, chans[i]->dev->name);
			return -ENODEV;
		}
		/* Park every channel at 0 rather than at whatever the reset default or a
		 * previous boot left on the pad. */
		int ret = led_set_brightness_dt(chans[i], 0);
		if (ret) {
			LOG_ERR("failed to turn off status LED channel %zu: %d", i, ret);
			return ret;
		}
	}

	bt_conn_cb_register(&conn_callbacks);

	/* Quick boot blink; BOOT end transitions to FLASH/ADV/ERROR. */
	enter(MODE_BOOT);

	LOG_INF("status LED ready (%s profile, %s channels, lit signals at %d%%)",
		IS_ENABLED(CONFIG_ZMK_SPLIT) && !IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
			? "peripheral"
			: "central",
		COND_CODE_1(LED_CHANNELS_ARE_PWM, ("pwm"), ("gpio")), LED_ON_PCT);

#if !LED_CHANNELS_ARE_PWM
	if (LED_ON_PCT < 100) {
		LOG_WRN("channels are plain GPIO: %d%% is ignored, a GPIO channel is on or off",
			LED_ON_PCT);
	}
#endif

	return 0;
}

SYS_INIT(status_led_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);
