/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * keeb,timeouts - "both halves run the same settings".
 *
 * Deep sleep, the matrix debounce and the status LED are decided per half: each
 * half runs its own ZMK activity timer, scans its own matrix and drives its own
 * LED.  Only the central holds a config channel, so the peripheral learns about
 * a change through this behaviour: the central calls
 * zmk_behavior_invoke_binding() (settings/keeb_settings.c), a behaviour with
 * BEHAVIOR_LOCALITY_GLOBAL is shipped to every peripheral by ZMK
 * (zmk/app/src/behavior.c), and the peripheral runs keeb_settings_relay_apply()
 * with what arrives.  It is the same channel the right half's panel already uses
 * for its artwork (ui/layer_sync.c + keeb,layer-art).
 *
 * The two uint32_t payload values are a pair of settings from one group
 * (timeouts, matrix debounce, LED colors, LED brightness, layer colors) and
 * event.position is the wire word the central packed: op in the low two bits
 * (APPLY / SAVE / DISCARD), the group id above it, the boolean settings above
 * that - see KEEB_RELAY_WIRE and the group constants in keeb_settings.h.  It has
 * to fit the one byte `position` is on the split wire; it is not a key position.
 *
 * The central's own copy of this driver is a deliberate no-op, for the same
 * reason layer_art's is: a GLOBAL invocation also runs locally, and this half
 * has already applied the values by the time it sends them.
 */

/* Without this the DT_INST macros below match nothing and the driver is never
 * instantiated - the same way the layer art relay once shipped broken. */
#define DT_DRV_COMPAT keeb_timeouts

#include <zephyr/device.h>
#include <zephyr/logging/log.h>

#include <drivers/behavior.h>
#include <zmk/behavior.h>

#include "keeb_settings.h"

#if !IS_ENABLED(CONFIG_ZMK_SPLIT) || IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
#define KEEB_TMO_CENTRAL 1
#else
#define KEEB_TMO_CENTRAL 0
#endif

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

static int timeouts_binding_pressed(struct zmk_behavior_binding *binding,
				    struct zmk_behavior_binding_event event)
{
#if KEEB_TMO_CENTRAL
	ARG_UNUSED(binding);
	ARG_UNUSED(event);
#else
	int err = keeb_settings_relay_apply(binding->param1, binding->param2, event.position);

	if (err) {
		LOG_WRN("settings relay refused (%d)", err);
	}
#endif

	return ZMK_BEHAVIOR_OPAQUE;
}

static int timeouts_binding_released(struct zmk_behavior_binding *binding,
				     struct zmk_behavior_binding_event event)
{
	ARG_UNUSED(binding);
	ARG_UNUSED(event);

	return ZMK_BEHAVIOR_OPAQUE;
}

static const struct behavior_driver_api timeouts_driver_api = {
	.locality = BEHAVIOR_LOCALITY_GLOBAL,
	.binding_pressed = timeouts_binding_pressed,
	.binding_released = timeouts_binding_released,
};

#define KEEB_TMO_INST(n)                                                                           \
	BEHAVIOR_DT_INST_DEFINE(n, NULL, NULL, NULL, NULL, POST_KERNEL,                            \
				CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, &timeouts_driver_api);

DT_INST_FOREACH_STATUS_OKAY(KEEB_TMO_INST)
