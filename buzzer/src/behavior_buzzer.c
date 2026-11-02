/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * zmk,behavior-buzzer - make a sound, then run another behavior.
 *
 * Why this behavior exists instead of a plain keymap binding pair: ZMK's combo
 * carries exactly ONE behavior binding (zmk/app/src/combo.c: struct combo_cfg
 * has a single `behavior`, extracted from bindings[0]), and &sys_reset calls
 * sys_reboot() inside its callback - so a reset chord that ends in &sys_reset
 * is gone before anything can sound, and there is no way to write
 * "beep; reset" as two bindings in a combo.
 *
 * So the tone is started asynchronously and the target behavior is re-invoked
 * on a delayable work item once the tone has finished, plus
 * CONFIG_ZMK_BUZZER_LEAD_MS. The keyboard stays live during the tone: the chord
 * is audible, the action follows it, and nothing blocks.
 *
 * The alternative - k_sleep() while beeping inside binding_pressed - was
 * rejected: ZMK runs behaviors through its behavior queue on the system work
 * queue, so blocking there stalls every other behavior for the length of the
 * tone, including the key the user pressed next.
 *
 * Which tune is played is the `tune` property (default "random"): a random
 * pattern says "something happened", a named tune says which one, and the
 * target is scheduled from the length the driver reports back, so a longer tune
 * just means the action lands a little later - never later than the tone.
 *
 * On a half with no zmk,buzzer node (the keeb right half has no buzzer),
 * zmk_buzzer_play_tune() returns -ENODEV and the target runs immediately:
 * same chord, no sound. Pressing the chord again while a tone is playing
 * restarts the tone and pushes the target later - there is only ever one
 * pending target, because the work item is rescheduled, not queued twice.
 */

#define DT_DRV_COMPAT zmk_behavior_buzzer

#include <zephyr/device.h>
#include <zephyr/devicetree.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include <drivers/behavior.h>
#include <zmk/behavior.h>
#include <zmk/buzzer.h>

LOG_MODULE_REGISTER(zmk_behavior_buzzer, CONFIG_ZMK_LOG_LEVEL);

#if DT_HAS_COMPAT_STATUS_OKAY(DT_DRV_COMPAT)

struct behavior_buzzer_config {
	struct zmk_behavior_binding target;
	bool has_target;
};

struct behavior_buzzer_data {
	struct k_work_delayable target_work;
	struct zmk_behavior_binding target; /* copy of cfg->target, for the work item */
	struct zmk_behavior_binding_event event;
	enum zmk_buzzer_tune tune; /* resolved once at init from the `tune` property */
};

static void target_work_fn(struct k_work *work) {
	/* A delayable work's callback still receives the inner struct k_work; the
	 * documented way back to the container is k_work_delayable_from_work(). */
	struct k_work_delayable *dwork = k_work_delayable_from_work(work);
	struct behavior_buzzer_data *data =
		CONTAINER_OF(dwork, struct behavior_buzzer_data, target_work);

	int ret = zmk_behavior_invoke_binding(&data->target, data->event, true);

	if (ret < 0) {
		LOG_WRN("follow-on behavior %s failed (%d)", data->target.behavior_dev, ret);
	}
}

static int buzzer_binding_pressed(struct zmk_behavior_binding *binding,
				  struct zmk_behavior_binding_event event) {
	const struct device *dev = zmk_behavior_get_binding(binding->behavior_dev);
	const struct behavior_buzzer_config *cfg = dev->config;
	struct behavior_buzzer_data *data = dev->data;

	uint32_t tone_ms = 0;
	int err = zmk_buzzer_play_tune(data->tune, &tone_ms);

	if (err < 0) {
		/* No buzzer on this half, or the half is heading into sleep: the
		 * action still runs, it just arrives without a sound. */
		LOG_DBG("no tone (%d), running the target immediately", err);
		tone_ms = 0;
	}

	if (!cfg->has_target) {
		return ZMK_BEHAVIOR_OPAQUE; /* sound only */
	}

	data->target = cfg->target;
	data->event = event;

	k_work_cancel_delayable(&data->target_work);
	k_work_schedule(&data->target_work, K_MSEC(tone_ms + CONFIG_ZMK_BUZZER_LEAD_MS));

	return ZMK_BEHAVIOR_OPAQUE;
}

static int buzzer_binding_released(struct zmk_behavior_binding *binding,
				   struct zmk_behavior_binding_event event) {
	ARG_UNUSED(binding);
	ARG_UNUSED(event);

	/* Nothing to undo: the tone is fire-and-forget and the target is a press
	 * action. OPAQUE keeps ZMK's behavior queue from waiting on a release. */
	return ZMK_BEHAVIOR_OPAQUE;
}

static const struct behavior_driver_api behavior_buzzer_driver_api = {
	.binding_pressed = buzzer_binding_pressed,
	.binding_released = buzzer_binding_released,
	/* The buzzer sits on the central half; a CENTRAL locality also means a
	 * peripheral that ever saw this binding forwards it to the central, where
	 * the hardware actually is. */
	.locality = BEHAVIOR_LOCALITY_CENTRAL,
#if IS_ENABLED(CONFIG_ZMK_BEHAVIOR_METADATA)
	.get_parameter_metadata = zmk_behavior_get_empty_param_metadata,
#endif /* CONFIG_ZMK_BEHAVIOR_METADATA */
};

static int buzzer_behavior_init(const struct device *dev) {
	struct behavior_buzzer_data *data = dev->data;

	k_work_init_delayable(&data->target_work, target_work_fn);

	return 0;
}

/* The tune name is resolved once per instance instead of on every press: the
 * binding's `enum` already rejects an unknown name at build time, so the only
 * way zmk_buzzer_tune_by_name() can fail here is if the C enum and the binding
 * list drift apart - which is why it logs instead of silently picking one. */
#define BUZZER_TUNE_INIT(n)                                                                        \
	static int buzzer_behavior_init_##n(const struct device *dev) {                            \
		struct behavior_buzzer_data *data = dev->data;                                     \
		int tune = zmk_buzzer_tune_by_name(DT_INST_PROP_OR(n, tune, "random"));            \
		if (tune < 0) {                                                                    \
			LOG_WRN("unknown tune \"%s\" on %s, playing random",                       \
				DT_INST_PROP_OR(n, tune, "random"), dev->name);                    \
			tune = ZMK_BUZZER_TUNE_RANDOM;                                             \
		}                                                                                  \
		data->tune = (enum zmk_buzzer_tune)tune;                                           \
		return buzzer_behavior_init(dev);                                                  \
	}

#define BUZZER_BEHAVIOR_INST(n)                                                                    \
	static struct behavior_buzzer_data behavior_buzzer_data_##n;                               \
	static const struct behavior_buzzer_config behavior_buzzer_config_##n = {                  \
		.has_target = DT_INST_NODE_HAS_PROP(n, target),                                    \
		COND_CODE_1(DT_INST_NODE_HAS_PROP(n, target),                                      \
			   (.target = {.behavior_dev = DEVICE_DT_NAME(DT_INST_PHANDLE(n, target)), \
				       .param1 = 0,                                                \
				       .param2 = 0},),                                             \
			   ())};                                                                   \
	BUZZER_TUNE_INIT(n)                                                                        \
	BEHAVIOR_DT_INST_DEFINE(n, buzzer_behavior_init_##n, NULL, &behavior_buzzer_data_##n,      \
				&behavior_buzzer_config_##n, POST_KERNEL,                          \
				CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, &behavior_buzzer_driver_api);

DT_INST_FOREACH_STATUS_OKAY(BUZZER_BEHAVIOR_INST)

#endif /* DT_HAS_COMPAT_STATUS_OKAY(zmk_behavior_buzzer) */
