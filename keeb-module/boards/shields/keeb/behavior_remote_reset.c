/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * keeb,remote-reset - reboot or bootloader-reset the RIGHT (peripheral)
 * half from a binding or a combo built out of right-half keys.
 *
 * Background: ZMK evaluates combos on the central half (the peripheral
 * only relays raw key positions), and &sys_reset / &bootloader are
 * source-locality behaviors - so binding those directly to a combo of
 * right-half keys would reset the LEFT half. This behavior instead means
 * "reboot the peripheral": invoked on the central, it forwards its target
 * behavior to peripheral 0 over the split behavior transport (the same
 * channel keeb,layer-art rides); if it ever runs on the peripheral
 * itself, that half IS the target, so it just invokes the target locally.
 * Either way the right half reboots.
 *
 * The nodes exist on both halves so the shared keymap resolves
 * everywhere.
 */

#define DT_DRV_COMPAT keeb_remote_reset

#include <zephyr/device.h>
#include <zephyr/logging/log.h>

#include <drivers/behavior.h>
#include <zmk/behavior.h>

#if IS_ENABLED(CONFIG_ZMK_SPLIT) && IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
#include <zmk/split/central.h>
#endif

LOG_MODULE_REGISTER(keeb_remote_reset, CONFIG_ZMK_LOG_LEVEL);

struct behavior_remote_reset_config {
	struct zmk_behavior_binding target;
};

static int remote_reset_pressed(struct zmk_behavior_binding *binding,
				struct zmk_behavior_binding_event event) {
	const struct device *dev = zmk_behavior_get_binding(binding->behavior_dev);
	const struct behavior_remote_reset_config *cfg = dev->config;

#if IS_ENABLED(CONFIG_ZMK_SPLIT) && IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
	/* Central side: ship the target behavior to peripheral 0 (the keeb
	 * split has exactly one peripheral - the right half). */
	struct zmk_behavior_binding target = cfg->target;

	int ret = zmk_split_central_invoke_behavior(0, &target, event, true);
	if (ret < 0) {
		LOG_WRN("right half not connected; reset not delivered (%d)", ret);
	}
#else
	/* Peripheral side: this half IS the reset target. */
	return zmk_behavior_invoke_binding(&cfg->target, event, true);
#endif

	return ZMK_BEHAVIOR_OPAQUE;
}

static int remote_reset_released(struct zmk_behavior_binding *binding,
				 struct zmk_behavior_binding_event event) {
	ARG_UNUSED(binding);
	ARG_UNUSED(event);

	/* A reboot never releases; OPAQUE keeps the queue tidy if the RPC
	 * could not be delivered. */
	return ZMK_BEHAVIOR_OPAQUE;
}

static const struct behavior_driver_api remote_reset_driver_api = {
	.binding_pressed = remote_reset_pressed,
	.binding_released = remote_reset_released,
	.locality = BEHAVIOR_LOCALITY_CENTRAL,
};

#define RST_INST(n)                                                                                \
	static const struct behavior_remote_reset_config behavior_remote_reset_config_##n = {          \
		.target = {.behavior_dev = DEVICE_DT_NAME(DT_INST_PHANDLE(n, target)),                     \
			   .param1 = 0,                                                                        \
			   .param2 = 0},                                                                       \
	};                                                                                             \
	BEHAVIOR_DT_INST_DEFINE(n, NULL, NULL, NULL, &behavior_remote_reset_config_##n, POST_KERNEL,   \
				CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, &remote_reset_driver_api);

DT_INST_FOREACH_STATUS_OKAY(RST_INST)
