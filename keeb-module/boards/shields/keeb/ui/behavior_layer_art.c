/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * keeb,layer-art - "show layer N's artwork on the other half".
 *
 * ZMK does not replicate active layer state to the peripheral: the peripheral
 * only ever sees behaviour invocations. The trick used here is a behaviour
 * with BEHAVIOR_LOCALITY_GLOBAL - when the central invokes it,
 * zmk_behavior_invoke_binding() ships it to every peripheral over the split
 * transport, which is exactly the channel the right hand display needs.
 *
 * layer_sync.c (central) is what invokes it; the peripheral receives the
 * invocation and remembers the layer index. The node exists on both halves so
 * that the central can resolve and invoke the behaviour locally as a no-op.
 */

#include <zephyr/device.h>
#include <zephyr/logging/log.h>

#include <drivers/behavior.h>
#include <zmk/behavior.h>

#if IS_ENABLED(CONFIG_KBEEB_UI_ART)
#include "panel_peripheral.h"
#endif

#if IS_ENABLED(CONFIG_KBEEB_LAYER_LED_INDICATE)
#include "layer_indicate.h"
#endif

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

static int layer_art_binding_pressed(struct zmk_behavior_binding *binding,
				     struct zmk_behavior_binding_event event) {
	LOG_DBG("layer art -> %u (position %d)", binding->param1, event.position);

#if IS_ENABLED(CONFIG_KBEEB_UI_ART)
	keeb_art_select(binding->param1);
#endif
#if IS_ENABLED(CONFIG_KBEEB_LAYER_LED_INDICATE)
	/* The same push that carries artwork to the peripheral also drives
	 * the per-half RGB layer indication (see layer_indicate.c). */
	keeb_layer_indicate(binding->param1);
#endif

	return ZMK_BEHAVIOR_OPAQUE;
}

static int layer_art_binding_released(struct zmk_behavior_binding *binding,
				      struct zmk_behavior_binding_event event) {
	ARG_UNUSED(binding);
	ARG_UNUSED(event);

	return ZMK_BEHAVIOR_OPAQUE;
}

static const struct behavior_driver_api layer_art_driver_api = {
	.locality = BEHAVIOR_LOCALITY_GLOBAL,
	.binding_pressed = layer_art_binding_pressed,
	.binding_released = layer_art_binding_released,
};

#define LAYER_ART_INST(n)                                                                          \
	BEHAVIOR_DT_INST_DEFINE(n, NULL, NULL, NULL, NULL, POST_KERNEL,                            \
				CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, &layer_art_driver_api);

DT_INST_FOREACH_STATUS_OKAY(LAYER_ART_INST)
