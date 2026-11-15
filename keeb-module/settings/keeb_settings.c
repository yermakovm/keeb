/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 */

#include "keeb_settings.h"

#include <zephyr/devicetree.h>
#include <zephyr/device.h>
#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#if IS_ENABLED(CONFIG_SETTINGS)
#include <zephyr/settings/settings.h>
#endif

#include <string.h>

#include <zmk/activity.h>
#include <zmk/hold_tap.h>
#include <zmk/kscan_debounce.h>

#if IS_ENABLED(CONFIG_ZMK_DISPLAY)
#include <zmk/display.h>
#endif

#if IS_ENABLED(CONFIG_ZMK_STATUS_LED)
#include <zmk/status_led.h>
#endif

#if IS_ENABLED(CONFIG_KEEB_UI)
#include "../boards/shields/keeb/ui/layer_indicate.h"
#endif

#if IS_ENABLED(CONFIG_ZMK_SPLIT) && IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
#include <zmk/behavior.h>
#include <zmk/events/position_state_changed.h>
#endif

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#if IS_ENABLED(CONFIG_KEEB_SETTINGS)

#define KEEB_SETTINGS_SUBTREE "keeb/settings"
#define KEEB_SETTINGS_KEY "keeb/settings/data"

#if IS_ENABLED(CONFIG_ZMK_SPLIT) && IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
/* The behaviour the relay rides on; its node lives in the shared keeb.dtsi, so
 * it exists on the peripheral too, which is the half that has to run it. */
#define KEEB_TMO_NODE DT_NODELABEL(keeb_tmo)
#define KEEB_TMO_DEV DEVICE_DT_NAME(KEEB_TMO_NODE)

/* ZMK ships the behaviour name in a 16 byte split payload, so the node name has
 * to stay short (same limit ui/layer_sync.c enforces for layer_art). */
BUILD_ASSERT(sizeof(KEEB_TMO_DEV) <= 16,
	     "keeb_tmo node name is too long for the split transport payload (16 bytes)");
#endif

static struct keeb_settings runtime_settings;
static bool dirty;

/* What this build says, so DISCARD can put it back and GET can report a real
 * number instead of the override's zero. */
#define KEEB_KSCAN_NODE DT_INST(0, zmk_kscan_gpio_matrix)
#define KEEB_KSCAN_OKAY DT_NODE_HAS_STATUS(KEEB_KSCAN_NODE, okay)

#define KEEB_HT_NODE DT_INST(0, zmk_behavior_hold_tap)
#define KEEB_HT_OKAY DT_NODE_HAS_STATUS(KEEB_HT_NODE, okay)

/* ZMK compiles the hold-tap driver on the central only (app/CMakeLists.txt),
 * which is also the half that resolves hold-taps. */
#define KEEB_HAS_HOLD_TAP                                                                          \
	(IS_ENABLED(CONFIG_ZMK_BEHAVIOR_HOLD_TAP) &&                                                 \
	 (!IS_ENABLED(CONFIG_ZMK_SPLIT) || IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)))

#if KEEB_HT_OKAY
#define KEEB_HT_DEFAULT_TAPPING_TERM DT_PROP(KEEB_HT_NODE, tapping_term_ms)
#define KEEB_HT_DEFAULT_QUICK_TAP DT_PROP(KEEB_HT_NODE, quick_tap_ms)
/* behavior_hold_tap.c uses quick-tap as the prior-idle window when the binding
 * asks for a global quick-tap. */
#define KEEB_HT_DEFAULT_PRIOR_IDLE                                                                 \
	COND_CODE_1(DT_PROP(KEEB_HT_NODE, global_quick_tap),                                       \
		    (DT_PROP(KEEB_HT_NODE, quick_tap_ms)), (DT_PROP(KEEB_HT_NODE, require_prior_idle_ms)))
#define KEEB_HT_DEFAULT_FLAVOR DT_ENUM_IDX(KEEB_HT_NODE, flavor)
#else
#define KEEB_HT_DEFAULT_TAPPING_TERM 0
#define KEEB_HT_DEFAULT_QUICK_TAP 0
#define KEEB_HT_DEFAULT_PRIOR_IDLE 0
#define KEEB_HT_DEFAULT_FLAVOR 0
#endif

/* The matrix driver's debounce lives in a const config struct in flash, so the
 * build values have to be read from the driver once, at init. */
static uint32_t flashed_debounce_press_ms;
static uint32_t flashed_debounce_release_ms;

/* --------------------------------------------------------------------------
 * Internal helpers
 * -------------------------------------------------------------------------- */

static void fill_defaults(struct keeb_settings *s)
{
	s->idle_timeout_ms = (uint32_t)CONFIG_ZMK_IDLE_TIMEOUT;
	s->sleep_timeout_ms = (uint32_t)CONFIG_ZMK_IDLE_SLEEP_TIMEOUT;
	s->debounce_press_ms = flashed_debounce_press_ms;
	s->debounce_release_ms = flashed_debounce_release_ms;
	/* Zero and FLAVOR_AUTO mean "no override": each hold-tap keeps its own
	 * devicetree value, so a build that tunes them per binding stays that way. */
	s->tapping_term_ms = 0;
	s->quick_tap_ms = 0;
	s->prior_idle_ms = 0;
	s->hold_tap_flavor = KEEB_SETTINGS_FLAVOR_AUTO;
	s->booleans = KEEB_SETTINGS_B_SLEEP_ALLOWED |
		      (IS_ENABLED(CONFIG_ZMK_DISPLAY_BLANK_ON_IDLE) ? KEEB_SETTINGS_B_BLANK_ON_IDLE
									: 0);

#if IS_ENABLED(CONFIG_ZMK_STATUS_LED)
	/* Compiled-in defaults, matching the driver's boot palette (brightness from
	 * Kconfig, colors the module's red/green/blue).  Not read from the driver:
	 * by the time DISCARD runs the driver may hold an override already. */
	s->led_color_red = 0x00FF0000u;
	s->led_color_green = 0x0000FF00u;
	s->led_color_blue = 0x000000FFu;
	s->led_brightness_percent = CONFIG_ZMK_STATUS_LED_BRIGHTNESS_PERCENT;
#else
	s->led_color_red = 0x00FF0000u;
	s->led_color_green = 0x0000FF00u;
	s->led_color_blue = 0x000000FFu;
	s->led_brightness_percent = 0;
#endif

	/* Layer colors are this build's answer to "what does layer N light up",
	 * pinned to the keymap layer index.  The same defaults a build without the
	 * settings channel falls back to (see keeb_settings.h). */
	static const uint32_t layer_defaults[KEEB_SETTINGS_LED_LAYER_MAX] = {KEEB_LED_DEFAULT_COLORS};

	memcpy(s->led_layer_colors, layer_defaults, sizeof(s->led_layer_colors));

	s->flags = 0;
}

static void reset_to_defaults(void)
{
	fill_defaults(&runtime_settings);
	dirty = false;
}

static bool wire_is_sane(const struct keeb_settings *s)
{
	if (s->flags & ~KEEB_SETTINGS_F_ALL) {
		return false;
	}

	if (s->booleans & ~KEEB_SETTINGS_B_ALL) {
		return false;
	}

	if (s->hold_tap_flavor > 3 && s->hold_tap_flavor != KEEB_SETTINGS_FLAVOR_AUTO) {
		return false;
	}

	return true;
}

static void apply_to_zmk(void)
{
	int err;

	err = zmk_activity_set_idle_timeout(runtime_settings.idle_timeout_ms);
	if (err) {
		LOG_WRN("zmk_activity_set_idle_timeout failed (%d)", err);
	}

	err = zmk_activity_set_sleep_timeout(runtime_settings.sleep_timeout_ms);
	if (err) {
		LOG_WRN("zmk_activity_set_sleep_timeout failed (%d)", err);
	}

	err = zmk_activity_set_sleep_enabled((runtime_settings.booleans & KEEB_SETTINGS_B_SLEEP_ALLOWED) != 0);
	if (err && err != -ENOTSUP) {
		LOG_WRN("zmk_activity_set_sleep_enabled failed (%d)", err);
	}

#if IS_ENABLED(CONFIG_ZMK_DISPLAY)
	zmk_display_set_blank_on_idle((runtime_settings.booleans & KEEB_SETTINGS_B_BLANK_ON_IDLE) != 0);
#endif

#if KEEB_KSCAN_OKAY
	/* Per half: each half scans its own matrix. */
	zmk_kscan_gpio_matrix_set_debounce_ms(DEVICE_DT_GET(KEEB_KSCAN_NODE),
					     runtime_settings.debounce_press_ms,
					     runtime_settings.debounce_release_ms);
#endif

#if KEEB_HAS_HOLD_TAP
	/* Central only in practice: only the central resolves hold-taps. Zero and
	 * FLAVOR_AUTO fall back to each binding's own devicetree value. */
	zmk_hold_tap_set_tapping_term_ms(runtime_settings.tapping_term_ms);
	zmk_hold_tap_set_quick_tap_ms(runtime_settings.quick_tap_ms);
	zmk_hold_tap_set_prior_idle_ms(runtime_settings.prior_idle_ms);
	zmk_hold_tap_set_flavor(runtime_settings.hold_tap_flavor == KEEB_SETTINGS_FLAVOR_AUTO
						? -1
						: (int)runtime_settings.hold_tap_flavor);
#endif

#if IS_ENABLED(CONFIG_ZMK_STATUS_LED)
	struct zmk_status_led_palette pal = {
		.brightness_percent = runtime_settings.led_brightness_percent,
		.red = runtime_settings.led_color_red,
		.green = runtime_settings.led_color_green,
		.blue = runtime_settings.led_color_blue,
	};

	zmk_status_led_set_palette(&pal);
#endif

#if IS_ENABLED(CONFIG_KEEB_UI)
	/* A layer color the host just changed should show on the layer this half is
	 * on now, not only on the next layer change.  On the peripheral that is the
	 * layer the central last pushed. */
	keeb_layer_indicate_refresh();
#endif

	LOG_INF("settings applied: idle=%u sleep=%u debounce=%u/%u tap=%d/%d/%d/%u sleep_allowed=%d blank=%d led=%u%% @%06x/%06x/%06x",
		runtime_settings.idle_timeout_ms, runtime_settings.sleep_timeout_ms,
		runtime_settings.debounce_press_ms, runtime_settings.debounce_release_ms,
		runtime_settings.tapping_term_ms, runtime_settings.quick_tap_ms,
		runtime_settings.prior_idle_ms, runtime_settings.hold_tap_flavor,
		(runtime_settings.booleans & KEEB_SETTINGS_B_SLEEP_ALLOWED) != 0,
		(runtime_settings.booleans & KEEB_SETTINGS_B_BLANK_ON_IDLE) != 0,
		runtime_settings.led_brightness_percent, runtime_settings.led_color_red,
		runtime_settings.led_color_green, runtime_settings.led_color_blue);
}

#if IS_ENABLED(CONFIG_SETTINGS)

static struct keeb_settings pending_settings;
static bool pending_has_settings;

static int keeb_settings_set_handler(const char *name, size_t len, settings_read_cb read_cb,
				     void *cb_arg)
{
	const char *next;

	if (settings_name_steq(name, "data", &next) && !next) {
		if (len > sizeof(pending_settings)) {
			return -EINVAL;
		}

		/* Seed with this build's values first: a blob saved by an older firmware
		 * is shorter than the struct is now, and a zero tail would read as
		 * "eager debounce" rather than as missing. */
		fill_defaults(&pending_settings);

		int err = read_cb(cb_arg, &pending_settings, sizeof(pending_settings));

		if (err <= 0) {
			LOG_ERR("settings read from flash failed (%d)", err);
			return err;
		}

		pending_has_settings = true;
		return 0;
	}

	return -ENOENT;
}

static int keeb_settings_commit_handler(void)
{
	if (pending_has_settings) {
		if (wire_is_sane(&pending_settings)) {
			memcpy(&runtime_settings, &pending_settings, sizeof(runtime_settings));
			runtime_settings.flags = 0;
			apply_to_zmk();
			dirty = false;
			LOG_INF("settings loaded from flash");
		} else {
			LOG_WRN("saved settings carry fields this build does not know, ignoring");
		}
		pending_has_settings = false;
	}

	return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(keeb_settings_store, KEEB_SETTINGS_SUBTREE, NULL,
			       keeb_settings_set_handler, keeb_settings_commit_handler, NULL);

#endif /* CONFIG_SETTINGS */

/* --------------------------------------------------------------------------
 * Public API
 * -------------------------------------------------------------------------- */

void keeb_settings_get(struct keeb_settings *out)
{
	memcpy(out, &runtime_settings, sizeof(*out));

	/* Report what the keyboard actually runs on: an unset hold-tap override is
	 * the zero that means "none", which is not a number a host can read. */
	if (!out->tapping_term_ms) {
		out->tapping_term_ms = KEEB_HT_DEFAULT_TAPPING_TERM;
	}
	if (!out->quick_tap_ms) {
		out->quick_tap_ms = KEEB_HT_DEFAULT_QUICK_TAP;
	}
	if (!out->prior_idle_ms) {
		out->prior_idle_ms = KEEB_HT_DEFAULT_PRIOR_IDLE;
	}
	if (out->hold_tap_flavor == KEEB_SETTINGS_FLAVOR_AUTO) {
		out->hold_tap_flavor = KEEB_HT_DEFAULT_FLAVOR;
	}

	out->flags = KEEB_SETTINGS_F_ALL;
}

/* "persist" in one place: the host's SETTINGS_SAVE and a peripheral's copy of
 * it both end up here. */
static int save_to_flash(void)
{
#if !IS_ENABLED(CONFIG_SETTINGS)
	return -KEEB_ERR_NOT_SUPPORTED;
#else
	int err = settings_save_one(KEEB_SETTINGS_KEY, &runtime_settings, sizeof(runtime_settings));

	if (err) {
		LOG_ERR("settings save failed (%d)", err);
		return -KEEB_ERR_STORAGE;
	}

	dirty = false;
	LOG_INF("settings saved to flash");

	return 0;
#endif
}

static void delete_saved(void)
{
#if IS_ENABLED(CONFIG_SETTINGS)
	settings_delete(KEEB_SETTINGS_KEY);
#endif
}

int keeb_settings_set(const uint8_t *data, uint16_t len)
{
	if (len < sizeof(struct keeb_settings)) {
		return -KEEB_ERR_BAD_LEN;
	}

	struct keeb_settings incoming;

	memcpy(&incoming, data, sizeof(incoming));

	if (!wire_is_sane(&incoming)) {
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	uint16_t present = incoming.flags;

	if (present & KEEB_SETTINGS_F_IDLE_TIMEOUT) {
		runtime_settings.idle_timeout_ms = incoming.idle_timeout_ms;
	}
	if (present & KEEB_SETTINGS_F_SLEEP_TIMEOUT) {
		runtime_settings.sleep_timeout_ms = incoming.sleep_timeout_ms;
	}
	if (present & KEEB_SETTINGS_F_DEBOUNCE_PRESS) {
		runtime_settings.debounce_press_ms = incoming.debounce_press_ms;
	}
	if (present & KEEB_SETTINGS_F_DEBOUNCE_RELEASE) {
		runtime_settings.debounce_release_ms = incoming.debounce_release_ms;
	}
	if (present & KEEB_SETTINGS_F_TAPPING_TERM) {
		runtime_settings.tapping_term_ms = incoming.tapping_term_ms;
	}
	if (present & KEEB_SETTINGS_F_QUICK_TAP) {
		runtime_settings.quick_tap_ms = incoming.quick_tap_ms;
	}
	if (present & KEEB_SETTINGS_F_PRIOR_IDLE) {
		runtime_settings.prior_idle_ms = incoming.prior_idle_ms;
	}
	if (present & KEEB_SETTINGS_F_HOLD_TAP_FLAVOR) {
		runtime_settings.hold_tap_flavor = incoming.hold_tap_flavor;
	}
	if (present & KEEB_SETTINGS_F_SLEEP_ALLOWED) {
		if (incoming.booleans & KEEB_SETTINGS_B_SLEEP_ALLOWED) {
			runtime_settings.booleans |= KEEB_SETTINGS_B_SLEEP_ALLOWED;
		} else {
			runtime_settings.booleans &= (uint8_t)~KEEB_SETTINGS_B_SLEEP_ALLOWED;
		}
	}
	if (present & KEEB_SETTINGS_F_BLANK_ON_IDLE) {
		if (incoming.booleans & KEEB_SETTINGS_B_BLANK_ON_IDLE) {
			runtime_settings.booleans |= KEEB_SETTINGS_B_BLANK_ON_IDLE;
		} else {
			runtime_settings.booleans &= (uint8_t)~KEEB_SETTINGS_B_BLANK_ON_IDLE;
		}
	}

	if (present & KEEB_SETTINGS_F_LED_BRIGHTNESS) {
		runtime_settings.led_brightness_percent =
			incoming.led_brightness_percent > 100 ? 100 : incoming.led_brightness_percent;
	}
	if (present & KEEB_SETTINGS_F_LED_COLOR_RED) {
		runtime_settings.led_color_red = incoming.led_color_red & 0x00FFFFFFu;
	}
	if (present & KEEB_SETTINGS_F_LED_COLOR_GREEN) {
		runtime_settings.led_color_green = incoming.led_color_green & 0x00FFFFFFu;
	}
	if (present & KEEB_SETTINGS_F_LED_COLOR_BLUE) {
		runtime_settings.led_color_blue = incoming.led_color_blue & 0x00FFFFFFu;
	}
	if (present & KEEB_SETTINGS_F_LED_LAYERS) {
		/* The table is written whole: a partial layer color edit would need a
		 * host that knows which entries it meant to leave alone. */
		for (uint8_t i = 0; i < KEEB_SETTINGS_LED_LAYER_MAX; i++) {
			runtime_settings.led_layer_colors[i] = incoming.led_layer_colors[i] & 0x00FFFFFFu;
		}
	}

	runtime_settings.flags = present;
	dirty = true;

	apply_to_zmk();

	keeb_settings_relay(KEEB_RELAY_APPLY);

	return 0;
}

#if IS_ENABLED(CONFIG_KEEB_ENGINE)
/* The only function here that speaks TLV, so it is compiled with the TLV codec
 * (proto/keeb_tlv.c is an engine source) and the peripheral build of this
 * module does not reference it. */
int keeb_settings_dump(struct keeb_tlv_msg *msg)
{
	struct keeb_settings current;

	keeb_settings_get(&current);

	if (keeb_tlv_rec_add_struct(msg, KEEB_T_SETTINGS, &current, sizeof(current))) {
		return -KEEB_ERR_TOO_BIG;
	}

	return 0;
}
#endif

int keeb_settings_save(void)
{
	int err = save_to_flash();

	if (!err) {
		keeb_settings_relay(KEEB_RELAY_SAVE);
	}

	return err;
}

int keeb_settings_discard(void)
{
	reset_to_defaults();
	apply_to_zmk();
	delete_saved();

	LOG_INF("settings reverted to defaults");

	keeb_settings_relay(KEEB_RELAY_DISCARD);

	return 0;
}

/* --------------------------------------------------------------------------
 * The split relay
 * -------------------------------------------------------------------------- */

/*
 * Central half: ship the values this half just settled on to every peripheral.
 *
 * The vehicle is ZMK's split "invoke a behaviour" command, which is the only
 * central->peripheral message a peripheral will run arbitrary code for:
 * zmk_behavior_invoke_binding() delivers a BEHAVIOR_LOCALITY_GLOBAL behaviour
 * to every peripheral (zmk/app/src/behavior.c) and settings/
 * behavior_keeb_timeouts.c runs it there.  It is the same channel the right
 * half's panel already uses for its artwork (ui/layer_sync.c + keeb,layer-art).
 *
 * Both timeouts travel every time, not just the one that changed: a half that
 * kept one of its own numbers is exactly the divergence this relay exists to
 * remove.  The op travels in the event's `position` - it is not a key position,
 * same trick ui/layer_sync.c uses for "not a real press" - and `position` is a
 * single byte once it reaches the peripheral, so what is packed in it is
 * KEEB_RELAY_WIRE and nothing wider.
 *
 * The payload is two uint32_t per invocation, so each change ships one group of
 * two numbers at a time with the group id and the boolean settings packed into
 * `position` alongside the op.  The hold-tap fields stay home: only the central
 * resolves hold-taps.
 */
void keeb_settings_relay(uint8_t op)
{
#if IS_ENABLED(CONFIG_ZMK_SPLIT) && IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
	struct keeb_settings current;

	keeb_settings_get(&current);

	for (uint8_t group = 0; group < KEEB_RELAY_GROUP_COUNT; group++) {
		struct zmk_behavior_binding binding = {
			.behavior_dev = KEEB_TMO_DEV,
		};
		struct zmk_behavior_binding_event event = {
			.position = KEEB_RELAY_WIRE(op, group, current.booleans),
			.timestamp = k_uptime_get(),
			.source = ZMK_POSITION_STATE_CHANGE_SOURCE_LOCAL,
		};

		switch (group) {
		case KEEB_RELAY_GROUP_TIMEOUTS:
			binding.param1 = current.idle_timeout_ms;
			binding.param2 = current.sleep_timeout_ms;
			break;
		case KEEB_RELAY_GROUP_MATRIX:
			binding.param1 = current.debounce_press_ms;
			binding.param2 = current.debounce_release_ms;
			break;
		case KEEB_RELAY_GROUP_LED_RGB:
			binding.param1 = current.led_color_red;
			binding.param2 = current.led_color_green;
			break;
		case KEEB_RELAY_GROUP_LED_OTHER:
			binding.param1 = current.led_color_blue;
			binding.param2 = current.led_brightness_percent;
			break;
		case KEEB_RELAY_GROUP_LED_LAYER_01:
		case KEEB_RELAY_GROUP_LED_LAYER_23:
		case KEEB_RELAY_GROUP_LED_LAYER_45:
		case KEEB_RELAY_GROUP_LED_LAYER_67: {
			uint8_t first = (uint8_t)(group - KEEB_RELAY_GROUP_LED_LAYER_01) * 2u;

			binding.param1 = current.led_layer_colors[first];
			binding.param2 = current.led_layer_colors[first + 1u];
			break;
		}
		}

		int err = zmk_behavior_invoke_binding(&binding, event, true);

		if (err < 0) {
			/* Usually the other half is not connected.  ui/layer_sync.c re-pushes
			 * on the connect edge, so a link that was down catches up. */
			LOG_WRN("settings relay to the peripheral failed (group %u, %d)", group, err);
		}
	}
#endif
}

/*
 * Peripheral half: what the central just decided, applied here.
 *
 * The numbers are the central's, including for DISCARD - "both halves agree"
 * is the whole point of the relay, and both halves are built from the same
 * config anyway.  What differs per half is only where the numbers are stored:
 * each half keeps its own copy in its own flash.
 */
int keeb_settings_relay_apply(uint32_t first, uint32_t second, uint32_t wire)
{
	uint8_t op = KEEB_RELAY_OP_OF(wire);
	uint8_t group = KEEB_RELAY_GROUP_OF(wire);
	uint8_t bools = KEEB_RELAY_BOOLS_OF(wire);

	switch (group) {
	case KEEB_RELAY_GROUP_TIMEOUTS:
		runtime_settings.idle_timeout_ms = first;
		runtime_settings.sleep_timeout_ms = second;
		break;
	case KEEB_RELAY_GROUP_MATRIX:
		runtime_settings.debounce_press_ms = first;
		runtime_settings.debounce_release_ms = second;
		break;
	case KEEB_RELAY_GROUP_LED_RGB:
		runtime_settings.led_color_red = first & 0x00FFFFFFu;
		runtime_settings.led_color_green = second & 0x00FFFFFFu;
		break;
	case KEEB_RELAY_GROUP_LED_OTHER:
		runtime_settings.led_color_blue = first & 0x00FFFFFFu;
		runtime_settings.led_brightness_percent =
			second > 100 ? runtime_settings.led_brightness_percent : second;
		break;
	case KEEB_RELAY_GROUP_LED_LAYER_01:
	case KEEB_RELAY_GROUP_LED_LAYER_23:
	case KEEB_RELAY_GROUP_LED_LAYER_45:
	case KEEB_RELAY_GROUP_LED_LAYER_67: {
		uint8_t at = (uint8_t)(group - KEEB_RELAY_GROUP_LED_LAYER_01) * 2u;

		runtime_settings.led_layer_colors[at] = first & 0x00FFFFFFu;
		runtime_settings.led_layer_colors[at + 1u] = second & 0x00FFFFFFu;
		break;
	}
	default:
		LOG_WRN("settings relay for unknown group %u, ignored", group);
		return -KEEB_ERR_UNKNOWN_TYPE;
	}

	if (bools & ~KEEB_SETTINGS_B_ALL) {
		LOG_WRN("settings relay with unknown boolean settings 0x%02x, ignored", bools);
		return -KEEB_ERR_OUT_OF_RANGE;
	}

	switch (op) {
	case KEEB_RELAY_APPLY:
	case KEEB_RELAY_SAVE:
		runtime_settings.booleans = bools;
		runtime_settings.flags = 0;
		dirty = true;
		break;
	case KEEB_RELAY_DISCARD:
		/* Both halves are built from the same config, so this half's own build
		 * values are the ones the central just reset to. */
		fill_defaults(&runtime_settings);
		dirty = false;
		delete_saved();
		break;
	default:
		LOG_WRN("settings relay with unknown op %u, ignored", op);
		return -KEEB_ERR_UNKNOWN_TYPE;
	}

	apply_to_zmk();

	/* SAVE persists once, on the last group the central sends: it is always
	 * delivered in order, so by then every field is in RAM and there is no
	 * point writing flash four times an op. */
	if (op == KEEB_RELAY_SAVE && group == KEEB_RELAY_GROUP_COUNT - 1) {
		return save_to_flash();
	}

	return 0;
}

bool keeb_settings_dirty(void)
{
	return dirty;
}

uint32_t keeb_settings_layer_color(uint8_t index)
{
	return index < KEEB_SETTINGS_LED_LAYER_MAX ? runtime_settings.led_layer_colors[index] : 0u;
}

uint32_t keeb_settings_capabilities(void)
{
	return KEEB_INFO_F_SETTINGS;
}

/* --------------------------------------------------------------------------
 * Init
 * -------------------------------------------------------------------------- */

static int keeb_settings_init_impl(void)
{
#if KEEB_KSCAN_OKAY
	zmk_kscan_gpio_matrix_get_debounce_ms(DEVICE_DT_GET(KEEB_KSCAN_NODE), &flashed_debounce_press_ms,
					     &flashed_debounce_release_ms);
#endif

	reset_to_defaults();

#if !IS_ENABLED(CONFIG_SETTINGS)
	/* No flash persistence: apply defaults immediately. */
	apply_to_zmk();
#endif

	LOG_INF("keeb settings initialized");

	return 0;
}

SYS_INIT(keeb_settings_init_impl, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);

#endif /* CONFIG_KEEB_SETTINGS */
