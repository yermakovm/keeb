/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * keeb,layer-art - "the other half should show layer N's artwork, on device D".
 *
 * ZMK does not replicate active layer state to the peripheral: the peripheral
 * only ever sees behaviour invocations. The trick is a behaviour with
 * BEHAVIOR_LOCALITY_GLOBAL - when the central invokes it,
 * zmk_behavior_invoke_binding() ships it to every peripheral over the split
 * transport, which is exactly the channel the right hand display needs.
 *
 * layer_sync.c (central) is what invokes it. The peripheral receives the
 * invocation and remembers param1 (the layer whose artwork to show) and
 * param2 (the device the central is talking to).
 *
 * The node lives in the shared keeb.dtsi, so it exists on both halves - which
 * is why the central's own copy of this driver is a deliberate no-op: an
 * invocation the central makes is also run locally, and this half's panel reads
 * its layer from ZMK directly. Calling the peripheral panel code here would not
 * even link: panel_peripheral.c is only compiled on the peripheral.
 */

/* Without this the DT_INST macros below match nothing and the driver is
 * silently never instantiated - which is exactly how this behaviour shipped
 * broken: the split relay looked wired up and never ran. */
#define DT_DRV_COMPAT keeb_layer_art

#include <zephyr/device.h>
#include <zephyr/logging/log.h>

#include <drivers/behavior.h>
#include <zmk/behavior.h>

#if !IS_ENABLED(CONFIG_ZMK_SPLIT) || IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
#define LAYER_ART_CENTRAL 1
#else
#define LAYER_ART_CENTRAL 0
#endif

#if !LAYER_ART_CENTRAL
#include "panel_peripheral.h"
#endif

#if IS_ENABLED(CONFIG_KBEEB_LAYER_LED_INDICATE)
#include "layer_indicate.h"
#endif

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

static int layer_art_binding_pressed(struct zmk_behavior_binding *binding,
				     struct zmk_behavior_binding_event event) {
#if LAYER_ART_CENTRAL
	ARG_UNUSED(binding);
	ARG_UNUSED(event);
#else
	LOG_DBG("layer art -> %u (device %u, position %d)", binding->param1, binding->param2,
		event.position);

	keeb_art_select(binding->param1);
	keeb_device_select(binding->param2);
#endif

#if IS_ENABLED(CONFIG_KBEEB_LAYER_LED_INDICATE)
	/* The same push that carries artwork to the peripheral also drives
	 * each half's RGB layer indication (see layer_indicate.c). */
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
