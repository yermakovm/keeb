/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Blank the nice!view panel on deep-sleep entry.
 *
 * ZMK raises ZMK_ACTIVITY_SLEEP right before it suspends devices and
 * calls sys_poweroff() (System OFF). The LS011B7DH03 memory LCD is
 * bistable: it keeps showing its last frame with zero power. Its DISP
 * pin is not wired to any GPIO (see keeb.dtsi; upstream nice_view does
 * not wire one either), so display_blanking_on() is a -ENOTSUP no-op -
 * the only firmware way to clear the glass is to paint a blank frame
 * through LVGL. That also removes the DC bias a static image would hold
 * across the LC while the SoC is off (VCOM inversion stops with it).
 *
 * The paint runs on ZMK's display work queue - the same thread as every
 * other LVGL call - and the activity listener blocks in k_work_flush()
 * until the frame is out, so the panel is guaranteed blank before
 * zmk_pm_suspend_devices() starts tearing down SPI. Deep sleep clears
 * RAM, so wake-up is a full reboot that redraws the status screen; there
 * is nothing to undo.
 */

#include <zephyr/kernel.h>
#include <zephyr/devicetree.h>

#if DT_HAS_CHOSEN(zephyr_display)

#include <zephyr/logging/log.h>

#include <lvgl.h>

#include <zmk/activity.h>
#include <zmk/display.h>
#include <zmk/events/activity_state_changed.h>

LOG_MODULE_REGISTER(keeb_display_sleep, CONFIG_ZMK_LOG_LEVEL);

static void blank_work_cb(struct k_work *work) {
	ARG_UNUSED(work);

	/* White screen, nothing on top of it. The UI is rebuilt from
	 * scratch by the reboot that follows deep sleep, so wiping the
	 * widget tree is fine. */
	lv_obj_clean(lv_screen_active());
	lv_obj_set_style_bg_color(lv_screen_active(), lv_color_white(), LV_PART_MAIN);
	lv_refr_now(lv_display_get_default());
}

K_WORK_DEFINE(blank_work, blank_work_cb);

static int display_sleep_activity_listener(const zmk_event_t *eh) {
	const struct zmk_activity_state_changed *ev = as_zmk_activity_state_changed(eh);

	if (ev->state != ZMK_ACTIVITY_SLEEP || !zmk_display_is_initialized()) {
		return ZMK_EV_EVENT_BUBBLE;
	}

	k_work_submit_to_queue(zmk_display_work_q(), &blank_work);

	/* Hold the pre-poweroff path until the blank frame is on the glass. */
	struct k_work_sync sync;
	(void)k_work_flush(&blank_work, &sync);

	return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(keeb_display_sleep, display_sleep_activity_listener);
ZMK_SUBSCRIPTION(keeb_display_sleep, zmk_activity_state_changed);

#endif /* DT_HAS_CHOSEN(zephyr_display) */
