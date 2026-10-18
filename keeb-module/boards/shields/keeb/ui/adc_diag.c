/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * TEMPORARY DIAGNOSTIC - do not ship.
 *
 * Samples every SAADC input (AIN0..AIN7) with the battery-divider gate
 * (P0.14, "READ BAT") driven low and released. The channel that tracks the
 * gate is the one the battery divider actually feeds, which is how we find
 * out whether the clone board really wired it to P0.31 like the schematic
 * claims.
 *
 * Enable with CONFIG_KBEEB_ADC_DIAG=y.
 */

#include <zephyr/kernel.h>
#include <zephyr/init.h>
#include <zephyr/device.h>
#include <zephyr/drivers/adc.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(adc_diag, LOG_LEVEL_INF);

#define GATE_PORT DT_NODELABEL(gpio0)
#define GATE_PIN 14
#define ADC_DEV DT_NODELABEL(adc)

static const struct device *const adc_dev = DEVICE_DT_GET(ADC_DEV);
static const struct device *const gate_port = DEVICE_DT_GET(GATE_PORT);

static int16_t diag_raw;

static void sample_ain7_curve(int gate_low) {
	int rc = gpio_pin_configure(gate_port, GATE_PIN, GPIO_OUTPUT);

	if (rc != 0) {
		LOG_ERR("gate cfg: %d", rc);
		return;
	}

	rc = gpio_pin_set(gate_port, GATE_PIN, gate_low);
	if (rc != 0) {
		LOG_ERR("gate set: %d", rc);
		return;
	}

	struct adc_channel_cfg cfg = {
		.gain = ADC_GAIN_1_6,
		.reference = ADC_REF_INTERNAL,
		.acquisition_time = ADC_ACQ_TIME(ADC_ACQ_TIME_MICROSECONDS, 40),
		.input_positive = SAADC_CH_PSELP_PSELP_AnalogInput7,
	};

	rc = adc_channel_setup(adc_dev, &cfg);
	if (rc != 0) {
		LOG_ERR("AIN7 setup: %d", rc);
		return;
	}

	/* Let the node settle through the top resistor, then trace how the
	 * reading converges as the SAADC keeps sampling. */
	k_sleep(K_MSEC(200));

	for (uint16_t i = 1; i <= 40; i++) {
		struct adc_sequence seq = {
			.channels = BIT(0),
			.buffer = &diag_raw,
			.buffer_size = sizeof(diag_raw),
			.oversampling = 4,
			.resolution = 12,
		};

		rc = adc_read(adc_dev, &seq);
		if (rc != 0) {
			LOG_ERR("AIN7 read: %d", rc);
			return;
		}

		int32_t mv = diag_raw;
		adc_raw_to_millivolts(adc_ref_internal(adc_dev), ADC_GAIN_1_6, 12, &mv);

		if (i == 1 || i == 2 || i == 5 || i == 10 || i == 20 || i == 30 || i == 40) {
			LOG_INF("gate=%d sample %2u: raw=%d %d mV", gate_low, i, diag_raw, mv);
		}

		k_sleep(K_MSEC(20));
	}
}

static void diag_work_cb(struct k_work *work) {
	sample_ain7_curve(1); /* gate released - divider open */
	sample_ain7_curve(0); /* gate low - divider enabled */
}

static K_WORK_DEFINE(diag_work, diag_work_cb);

static void diag_timer_fn(struct k_timer *timer) {
	ARG_UNUSED(timer);
	k_work_submit(&diag_work);
}

K_TIMER_DEFINE(diag_timer, diag_timer_fn, NULL);

static int adc_diag_init(void) {
	if (!device_is_ready(adc_dev)) {
		LOG_ERR("ADC not ready");
		return -ENODEV;
	}

	k_timer_start(&diag_timer, K_SECONDS(2), K_SECONDS(5));
	return 0;
}

SYS_INIT(adc_diag_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);
