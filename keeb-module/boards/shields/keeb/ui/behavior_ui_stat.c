/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * keeb,ui-stat - "the other half's panel should show these numbers". The
 * node is labelled uistat: the split payload only carries 8 characters of it.
 *
 * The peripheral half has no host connection, so typing rate, the active BLE
 * profile and the host link signal are facts only the central can produce.
 * layer_sync.c (central) invokes this behaviour once a second with
 * BEHAVIOR_LOCALITY_GLOBAL, the same channel keeb,layer-art uses. The
 * peripheral remembers the packed numbers and redraws.
 *
 * Packing (all in binding->param2, set in layer_sync.c):
 *   bits  0-7   active profile index, KEEB_PROFILE_NONE for none
 *   bits  8-15  how many profile pips to draw
 *   bits 16-23  host link signal, 0-100 %, KEEB_RSSI_INVALID for no link
 */

#define DT_DRV_COMPAT keeb_ui_stat

#include <zephyr/device.h>
#include <zephyr/logging/log.h>

#include <drivers/behavior.h>
#include <zmk/behavior.h>

#if !IS_ENABLED(CONFIG_ZMK_SPLIT) || IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
#define UI_STAT_CENTRAL 1
#else
#define UI_STAT_CENTRAL 0
#endif

#if !UI_STAT_CENTRAL
#include "panel_peripheral.h"
#endif

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

static int ui_stat_binding_pressed(struct zmk_behavior_binding *binding,
				   struct zmk_behavior_binding_event event) {
#if UI_STAT_CENTRAL
	ARG_UNUSED(binding);
	ARG_UNUSED(event);
#else
	keeb_ui_stat(binding->param1, binding->param2);
#endif

	return ZMK_BEHAVIOR_OPAQUE;
}

static int ui_stat_binding_released(struct zmk_behavior_binding *binding,
				    struct zmk_behavior_binding_event event) {
	ARG_UNUSED(binding);
	ARG_UNUSED(event);

	return ZMK_BEHAVIOR_OPAQUE;
}

static const struct behavior_driver_api ui_stat_driver_api = {
	.locality = BEHAVIOR_LOCALITY_GLOBAL,
	.binding_pressed = ui_stat_binding_pressed,
	.binding_released = ui_stat_binding_released,
};

#define UI_STAT_INST(n)                                                                            \
	BEHAVIOR_DT_INST_DEFINE(n, NULL, NULL, NULL, NULL, POST_KERNEL,                            \
				CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, &ui_stat_driver_api);

DT_INST_FOREACH_STATUS_OKAY(UI_STAT_INST)
