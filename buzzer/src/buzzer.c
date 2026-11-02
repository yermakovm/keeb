/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * zmk-buzzer - driver for one PASSIVE buzzer module (KY-006 / HW-508 piezo) on
 * one hardware PWM output.
 *
 * A passive piezo has no oscillator: a static HIGH on the signal line is
 * silence. It only sounds when the line is driven with a square wave, and the
 * frequency of that wave is the pitch. So this driver is a tone generator
 * (pwm_set_dt), not a GPIO switch - that was the earlier TMB12A03 active-buzzer
 * design, which needed a transistor to switch a ~30 mA coil; the KY-006 is a
 * piezo load and is driven straight from the pin.
 *
 * KY-006 specs that shape the code: usable roughly 1.5-2.5 kHz, loudest at its
 * ~2 kHz resonance, 3.3-5 V, <25 mA. Pitch is therefore drawn at random per
 * pulse from CONFIG_ZMK_BUZZER_FREQ_MIN_HZ..MAX_HZ, alongside the random rhythm
 * (pulse count, on-time, gap). "Random sound" here means random pitch AND
 * random rhythm, which an active buzzer could never do.
 *
 * Timing lives entirely on one delayable work item: nothing here sleeps, so a
 * tone overlaps typing instead of delaying it, and the behavior that wants
 * "sound first, then act" (zmk,behavior-buzzer) can schedule its follow-on
 * action from the reported pattern length.
 *
 * Sleep: silence is duty 0, which makes the nrfx PWM driver stop the peripheral
 * and park the pad LOW. The &pwm0 node also carries a `sleep` pinctrl state
 * (low-power-enable) that disconnects the pad on a PM suspend. Both matter
 * because the nRF52840 keeps pad state through System OFF - the same trait this
 * keyboard's matrix wake-up relies on - and a pad left being driven at 2 kHz
 * would keep the disc singing while the half "sleeps".
 *
 * Named tunes: a random pattern announces that something happened; a fixed
 * rhythm with fixed pitches can say *which* thing, and whether it went well.
 * A tune is a list of (pitch, on-time, gap) steps with the pitches expressed as
 * percentages of CONFIG_ZMK_BUZZER_TUNE_BASE_HZ, so the whole vocabulary re-tunes
 * to a different piezo with one number. The driver plays them for events it can
 * see by itself - a layer this node was told to announce (`beep-layers`), and a
 * boot that the SoC says came from System OFF (`beep-on-wake`) - and
 * zmk,behavior-buzzer plays the one its `tune` property names, while the TLV
 * engine reports its own accepted/refused updates through zmk_buzzer_play_tune().
 */

#include <zephyr/devicetree.h>
#include <zephyr/device.h>
#include <zephyr/drivers/pwm.h>
#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/random/random.h>
#include <zephyr/sys/util.h>
#include <zephyr/sys_clock.h>
#include <string.h>

#include <zmk/activity.h>
#include <zmk/buzzer.h>
#include <zmk/event_manager.h>
#include <zmk/events/activity_state_changed.h>
#include <zmk/events/layer_state_changed.h>

/* "Did this boot come from ZMK sleep?" is a SoC question, not a ZMK one: ZMK
 * sleeps by suspending devices and calling sys_poweroff(), which on the nRF52840
 * is System OFF - RAM is gone and the wake is a cold boot, so there is no
 * in-RAM memory of having slept. POWER.RESETREAS survives that and reports the
 * wake reason (OFF = wake up from System OFF triggered by the GPIO DETECT line,
 * which is exactly what the matrix drives), so the question is answerable.
 * BUZZER_HAS_RESETREAS is the portable guard: the register exists on Nordic
 * Cortex-M SoCs, and a board without it simply cannot tell. */
#if defined(CONFIG_SOC_SERIES_NRF52X) || defined(CONFIG_SOC_SERIES_NRF51X)
#include <hal/nrf_power.h>
#define BUZZER_HAS_RESETREAS 1
#else
#define BUZZER_HAS_RESETREAS 0
#endif

LOG_MODULE_REGISTER(zmk_buzzer, CONFIG_ZMK_LOG_LEVEL);

#define DT_DRV_COMPAT zmk_buzzer

/* The name side of enum zmk_buzzer_tune. Designated initializers keep name and
 * value tied together, so reordering the enum cannot silently pair "wake" with
 * the bootloader tune; the `enum` list in the zmk,behavior-buzzer binding is
 * what rejects an unknown name at build time. */
int zmk_buzzer_tune_by_name(const char *name) {
	static const char *const names[ZMK_BUZZER_TUNE_COUNT] = {
		[ZMK_BUZZER_TUNE_RANDOM] = "random",
		[ZMK_BUZZER_TUNE_LAYER_ON] = "layer_on",
		[ZMK_BUZZER_TUNE_LAYER_OFF] = "layer_off",
		[ZMK_BUZZER_TUNE_BOOTLOADER] = "bootloader",
		[ZMK_BUZZER_TUNE_UPDATE_OK] = "update_ok",
		[ZMK_BUZZER_TUNE_UPDATE_FAIL] = "update_fail",
		[ZMK_BUZZER_TUNE_WAKE] = "wake",
	};

	if (name == NULL) {
		return ZMK_BUZZER_TUNE_RANDOM;
	}

	for (int i = 0; i < ZMK_BUZZER_TUNE_COUNT; i++) {
		if (strcmp(names[i], name) == 0) {
			return i;
		}
	}

	return -EINVAL;
}

#if !DT_HAS_COMPAT_STATUS_OKAY(DT_DRV_COMPAT)

/*
 * No zmk,buzzer node on this half. The keeb shield declares the device (and
 * enables &pwm0) on the LEFT half only - that is where the buzzer is soldered -
 * while the behavior node and this header are shared, because config/keeb.keymap
 * is compiled for both halves. The stub keeps the API linkable everywhere and
 * reports honestly: no buzzer here.
 */

int zmk_buzzer_play(uint8_t pulses, uint16_t on_ms, uint16_t gap_ms, uint16_t freq_hz) {
	ARG_UNUSED(pulses);
	ARG_UNUSED(on_ms);
	ARG_UNUSED(gap_ms);
	ARG_UNUSED(freq_hz);
	return -ENODEV;
}

int zmk_buzzer_play_random(uint32_t *duration_ms) {
	ARG_UNUSED(duration_ms);
	return -ENODEV;
}

int zmk_buzzer_play_tune(enum zmk_buzzer_tune tune, uint32_t *duration_ms) {
	ARG_UNUSED(tune);
	ARG_UNUSED(duration_ms);
	return -ENODEV;
}

void zmk_buzzer_stop(void) {}

bool zmk_buzzer_busy(void) { return false; }

#else /* a zmk,buzzer node exists */

/* PWM_DT_SPEC_GET() always reads the `pwms` property. Its period cell is the
 * base tone period, used only as the reference value for the silence calls -
 * every beep sets its own period, i.e. its own pitch. */
static const struct pwm_dt_spec tone = PWM_DT_SPEC_GET(DT_DRV_INST(0));

/* A tune is a fixed sequence of (pitch, on-time, gap) steps. Pitch is a
 * percentage of CONFIG_ZMK_BUZZER_TUNE_BASE_HZ, so a tune is a shape (rising,
 * falling, a double buzz) rather than a set of absolute frequencies: change the
 * base and every tune follows the piezo you actually soldered.
 *
 * The percentages below are written for the KY-006's useful band (~1.5-2.5 kHz,
 * loudest near its ~2 kHz resonance), i.e. 75%-130% of the default base of
 * 2000 Hz. A gap of 0 means "this is the last step" - the trailing gap is never
 * played, which is also what makes a tune's length predictable.
 */
struct tune_step {
	uint16_t pitch_pct;
	uint16_t on_ms;
	uint16_t gap_ms;
};

/* Entering the announced layer: two rising notes, "you are somewhere else now". */
static const struct tune_step tune_layer_on[] = {{90, 45, 30}, {115, 80, 0}};

/* Leaving it: the same two notes upside down, so on/off cannot be confused. */
static const struct tune_step tune_layer_off[] = {{115, 45, 30}, {90, 80, 0}};

/* Three descending notes: the app is about to disappear, and the sound goes the
 * same way the keyboard is about to. Long enough to be heard over the reboot. */
static const struct tune_step tune_bootloader[] = {{120, 60, 20}, {100, 60, 20}, {80, 120, 0}};

/* Accepted: a short bright rising ding, the one tune here that is meant to be
 * pleasant, because this one is the common case. */
static const struct tune_step tune_update_ok[] = {{105, 55, 25}, {125, 110, 0}};

/* Refused: the same low note twice. Repetition at a constant pitch is what
 * reads as "no" next to update_ok's rising pair, and it is deliberately not the
 * mirror of it - a failure should not sound like a layer toggle. */
static const struct tune_step tune_update_fail[] = {{80, 120, 80}, {80, 160, 0}};

/* Woke from System OFF: brief and soft - this one fires while the key that woke
 * the board is still being pressed, in the middle of an ordinary typing session. */
static const struct tune_step tune_wake[] = {{95, 35, 20}, {120, 55, 0}};

#define TUNE_LEN(t) (sizeof(t) / sizeof((t)[0]))

struct tune {
	const struct tune_step *steps;
	uint8_t count;
};

static const struct tune tunes[ZMK_BUZZER_TUNE_COUNT] = {
	[ZMK_BUZZER_TUNE_RANDOM] = {NULL, 0}, /* generated per call, see play_random() */
	[ZMK_BUZZER_TUNE_LAYER_ON] = {tune_layer_on, TUNE_LEN(tune_layer_on)},
	[ZMK_BUZZER_TUNE_LAYER_OFF] = {tune_layer_off, TUNE_LEN(tune_layer_off)},
	[ZMK_BUZZER_TUNE_BOOTLOADER] = {tune_bootloader, TUNE_LEN(tune_bootloader)},
	[ZMK_BUZZER_TUNE_UPDATE_OK] = {tune_update_ok, TUNE_LEN(tune_update_ok)},
	[ZMK_BUZZER_TUNE_UPDATE_FAIL] = {tune_update_fail, TUNE_LEN(tune_update_fail)},
	[ZMK_BUZZER_TUNE_WAKE] = {tune_wake, TUNE_LEN(tune_wake)},
};

#define MAX_PULSES CONFIG_ZMK_BUZZER_PULSES_MAX

/* The pattern buffer has to hold the longest thing this file can play: the
 * longest random pattern the Kconfig allows, or the longest named tune. Adding
 * a step to a tune widens this on its own. */
#define BUZZER_SEQ_MAX                                                                             \
	MAX(MAX(TUNE_LEN(tune_layer_on), TUNE_LEN(tune_layer_off)),                                 \
	    MAX(MAX(TUNE_LEN(tune_bootloader), TUNE_LEN(tune_update_ok)),                          \
	        MAX(MAX(TUNE_LEN(tune_update_fail), TUNE_LEN(tune_wake)), MAX_PULSES)))

/* Below the piezo's useful band a beep is inaudible rather than wrong, but a
 * division by it is not something to hand to a pattern generator. */
#define MIN_FREQ_HZ 200
#define MAX_FREQ_HZ 8000

struct pulse {
	uint16_t on_ms;
	uint16_t gap_ms; /* 0 on the last pulse: the trailing gap is not played */
	uint16_t freq_hz;
};

static struct {
	struct pulse seq[BUZZER_SEQ_MAX];
	uint8_t pulses; /* pulses stored in seq */
	uint8_t index;  /* pulse currently being played */
	bool sounding;  /* currently in the ON half of seq[index] */
} pattern;


static bool suspended; /* ZMK activity state is SLEEP */

static void buzzer_tick(struct k_work *work);
static K_WORK_DELAYABLE_DEFINE(buzzer_work, buzzer_tick);

/* Inclusive range draw. Modulo bias over a ~2x range is irrelevant for a beep;
 * the entropy device is the nRF52 hardware RNG (see Kconfig). */
static uint16_t rand_range(uint16_t lo, uint16_t hi) {
	if (hi <= lo) {
		return lo;
	}

	return lo + (uint16_t)(sys_rand32_get() % (uint32_t)(hi - lo + 1));
}

static void tone_off(void) {
	/* Duty 0%: the driver stops the PWM peripheral and writes the pad LOW. */
	int ret = pwm_set_dt(&tone, tone.period, 0);

	if (ret < 0) {
		LOG_WRN("buzzer: could not stop the tone (%d)", ret);
	}
}

static void tone_on(uint16_t freq_hz) {
	if (freq_hz < MIN_FREQ_HZ) {
		freq_hz = MIN_FREQ_HZ;
	} else if (freq_hz > MAX_FREQ_HZ) {
		freq_hz = MAX_FREQ_HZ;
	}

	uint32_t period_ns = (uint32_t)(NSEC_PER_SEC / freq_hz);
	uint32_t pulse_ns =
	    (uint32_t)(((uint64_t)period_ns * CONFIG_ZMK_BUZZER_DUTY_PERCENT) / 100U);

	if (pulse_ns == 0) {
		pulse_ns = 1; /* duty 0 would mean silence, not a quiet beep */
	}

	int ret = pwm_set_dt(&tone, period_ns, pulse_ns);

	if (ret < 0) {
		LOG_WRN("buzzer: tone %u Hz failed (%d)", freq_hz, ret);
	}
}

static void pattern_stop(void) {
	k_work_cancel_delayable(&buzzer_work);
	tone_off();
	pattern.sounding = false;
	pattern.index = 0;
	pattern.pulses = 0;
}

static void buzzer_tick(struct k_work *work) {
	if (!pattern.sounding) {
		tone_on(pattern.seq[pattern.index].freq_hz);
		pattern.sounding = true;
		k_work_schedule(&buzzer_work, K_MSEC(pattern.seq[pattern.index].on_ms));
		return;
	}

	tone_off();
	pattern.sounding = false;

	uint16_t gap_ms = pattern.seq[pattern.index].gap_ms;
	pattern.index++;

	if (pattern.index >= pattern.pulses) {
		return; /* done; the pad is already LOW, no reschedule */
	}

	k_work_schedule(&buzzer_work, K_MSEC(gap_ms));
}

int zmk_buzzer_play(uint8_t pulses, uint16_t on_ms, uint16_t gap_ms, uint16_t freq_hz) {
	if (!device_is_ready(tone.dev)) {
		return -ENODEV;
	}

	if (suspended) {
		return -EAGAIN;
	}

	if (pulses == 0) {
		return -EINVAL;
	}

	if (pulses > MAX_PULSES) {
		pulses = MAX_PULSES;
	}

	k_work_cancel_delayable(&buzzer_work);

	for (uint8_t i = 0; i < pulses; i++) {
		pattern.seq[i].on_ms = on_ms;
		pattern.seq[i].gap_ms = (i + 1 < pulses) ? gap_ms : 0;
		/* freq_hz 0 = "whatever you like": a fresh pitch per beep. */
		pattern.seq[i].freq_hz =
		    (freq_hz != 0) ? freq_hz : rand_range(CONFIG_ZMK_BUZZER_FREQ_MIN_HZ,
			                                         CONFIG_ZMK_BUZZER_FREQ_MAX_HZ);
	}

	pattern.pulses = pulses;
	pattern.index = 0;
	pattern.sounding = false;

	k_work_schedule(&buzzer_work, K_NO_WAIT);

	return 0;
}

static int play_random(uint32_t *duration_ms) {
	uint8_t pulses =
	    (uint8_t)rand_range(CONFIG_ZMK_BUZZER_PULSES_MIN, CONFIG_ZMK_BUZZER_PULSES_MAX);
	uint32_t total_ms = 0;

	k_work_cancel_delayable(&buzzer_work);

	for (uint8_t i = 0; i < pulses; i++) {
		uint16_t on_ms =
			rand_range(CONFIG_ZMK_BUZZER_ON_MS_MIN, CONFIG_ZMK_BUZZER_ON_MS_MAX);
		uint16_t gap_ms = 0;

		if (i + 1 < pulses) {
			gap_ms = rand_range(CONFIG_ZMK_BUZZER_GAP_MS_MIN,
					    CONFIG_ZMK_BUZZER_GAP_MS_MAX);
		}

		pattern.seq[i].on_ms = on_ms;
		pattern.seq[i].gap_ms = gap_ms;
		pattern.seq[i].freq_hz = rand_range(CONFIG_ZMK_BUZZER_FREQ_MIN_HZ,
		                                   CONFIG_ZMK_BUZZER_FREQ_MAX_HZ);
		total_ms += on_ms + gap_ms;
	}

	pattern.pulses = pulses;
	pattern.index = 0;
	pattern.sounding = false;

	k_work_schedule(&buzzer_work, K_NO_WAIT);

	if (duration_ms != NULL) {
		*duration_ms = total_ms;
	}

	LOG_DBG("buzzer pattern: %u pulses, %u ms", pulses, total_ms);

	return 0;
}

/* A tune step's pitch as a percentage of the base tone. Clamped here as well as
 * in tone_on(), so the reported length and the logged tune describe the tone
 * that is actually played. */
static uint16_t tune_pitch_hz(uint16_t pitch_pct) {
	uint32_t hz = ((uint32_t)CONFIG_ZMK_BUZZER_TUNE_BASE_HZ * pitch_pct) / 100U;

	if (hz < MIN_FREQ_HZ) {
		hz = MIN_FREQ_HZ;
	} else if (hz > MAX_FREQ_HZ) {
		hz = MAX_FREQ_HZ;
	}

	return (uint16_t)hz;
}

int zmk_buzzer_play_tune(enum zmk_buzzer_tune tune, uint32_t *duration_ms) {
	if (!device_is_ready(tone.dev)) {
		return -ENODEV;
	}

	if (suspended) {
		return -EAGAIN;
	}

	/* The one tune with no table: its shape is drawn when it is asked for, so
	 * its length is only known after drawing it - which is why the caller gets
	 * the duration back rather than looking it up first. */
	if (tune == ZMK_BUZZER_TUNE_RANDOM) {
		return play_random(duration_ms);
	}

	if (tune >= ZMK_BUZZER_TUNE_COUNT || tunes[tune].count == 0) {
		return -EINVAL;
	}

	const struct tune *t = &tunes[tune];
	uint32_t total_ms = 0;

	k_work_cancel_delayable(&buzzer_work);

	for (uint8_t i = 0; i < t->count; i++) {
		pattern.seq[i].freq_hz = tune_pitch_hz(t->steps[i].pitch_pct);
		pattern.seq[i].on_ms = t->steps[i].on_ms;
		pattern.seq[i].gap_ms = t->steps[i].gap_ms;
		total_ms += t->steps[i].on_ms + t->steps[i].gap_ms;
	}

	pattern.pulses = t->count;
	pattern.index = 0;
	pattern.sounding = false;

	k_work_schedule(&buzzer_work, K_NO_WAIT);

	if (duration_ms != NULL) {
		*duration_ms = total_ms;
	}

	LOG_DBG("buzzer tune %d: %u steps, %u ms", (int)tune, t->count, total_ms);

	return 0;
}

int zmk_buzzer_play_random(uint32_t *duration_ms) {
	return zmk_buzzer_play_tune(ZMK_BUZZER_TUNE_RANDOM, duration_ms);
}

void zmk_buzzer_stop(void) { pattern_stop(); }

bool zmk_buzzer_busy(void) { return k_work_delayable_is_pending(&buzzer_work); }

static int activity_changed_listener(const zmk_event_t *eh) {
	const struct zmk_activity_state_changed *ev = as_zmk_activity_state_changed(eh);

	if (ev == NULL) {
		return ZMK_EV_EVENT_BUBBLE;
	}

	if (ev->state == ZMK_ACTIVITY_SLEEP) {
		suspended = true;
		/* Must be silent before System OFF: the SoC keeps this pad's state. */
		pattern_stop();
	} else if (suspended) {
		suspended = false;
	}

	return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(buzzer_activity, activity_changed_listener);
ZMK_SUBSCRIPTION(buzzer_activity, zmk_activity_state_changed);

/* Which layers this buzzer announces comes from the devicetree (`beep-layers`),
 * so "the game layer makes a sound" is wiring, not code: no property, no
 * listener, no cost. ZMK raises one layer event per layer with its new state,
 * so entering and leaving are separate events and get different tunes.
 *
 * Layers you only hold (&mo / &lt) are not on the keeb list on purpose - a
 * momentary layer would beep twice per use. Layer 0 works but is noisy: ZMK
 * turns the default layer on at boot, so a boot would beep every boot. */
#if DT_NODE_HAS_PROP(DT_DRV_INST(0), beep_layers)
static const uint8_t beep_layers[] = DT_PROP(DT_DRV_INST(0), beep_layers);

static int layer_event_listener(const zmk_event_t *eh) {
	const struct zmk_layer_state_changed *ev = as_zmk_layer_state_changed(eh);

	if (ev == NULL) {
		return ZMK_EV_EVENT_BUBBLE;
	}

	for (size_t i = 0; i < ARRAY_SIZE(beep_layers); i++) {
		if (beep_layers[i] == ev->layer) {
			/* The tune carries the direction, so the event's own `state` is all
			 * this needs; a busy keyboard does not get a second tone queued. */
			(void)zmk_buzzer_play_tune(ev->state ? ZMK_BUZZER_TUNE_LAYER_ON
							 : ZMK_BUZZER_TUNE_LAYER_OFF,
							     NULL);
			break;
		}
	}

	return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(buzzer_layers, layer_event_listener);
ZMK_SUBSCRIPTION(buzzer_layers, zmk_layer_state_changed);
#endif /* beep-layers */

/* `beep-on-wake`. ZMK sleeps by suspending devices and calling sys_poweroff(),
 * which on the nRF52840 is System OFF: RAM is lost and the wake is a cold boot,
 * so nothing in the firmware remembers having slept. POWER.RESETREAS does - its
 * OFF bit means "woke up from System OFF on a GPIO DETECT event", which is
 * exactly what pressing a key does here. A soft reset (&sys_reset, &bootloader)
 * sets SREQ instead, so a reboot is not mistaken for a wake.
 *
 * This is the only reader of RESETREAS in this build (ZMK's own hwinfo use is
 * hwinfo_get_device_id()), and only the OFF bit is cleared, so a reset cause is
 * not eaten before anything else can report it. */
#if DT_NODE_HAS_PROP(DT_DRV_INST(0), beep_on_wake)
#if BUZZER_HAS_RESETREAS
static bool woke_from_sleep(void) {
	uint32_t reasons = nrf_power_resetreas_get(NRF_POWER);

	nrf_power_resetreas_clear(NRF_POWER, NRF_POWER_RESETREAS_OFF_MASK);

	return (reasons & NRF_POWER_RESETREAS_OFF_MASK) != 0;
}
#else
static bool woke_from_sleep(void) {
	LOG_WRN("beep-on-wake needs a SoC with a reset-reason register; this one cannot "
		"tell a wake from a cold boot");

	return false;
}
#endif
#endif /* beep-on-wake */

static int buzzer_init(void) {
	if (!device_is_ready(tone.dev)) {
		LOG_ERR("buzzer: PWM device %s not ready", tone.dev->name);
		return -ENODEV;
	}

	/* Park the pad at 0% duty instead of leaving it at whatever reset or a
	 * previous boot left there: a floating or HIGH line is silence on a
	 * passive piezo, but LOW is unambiguous. */
	tone_off();

#if DT_NODE_HAS_PROP(DT_DRV_INST(0), beep_on_wake)
	/* Early, on purpose: the key that woke the board is already pressed by the
	 * time this runs, and a tone that arrives after the first keystroke reads as
	 * the keyboard answering instead of waking. */
	if (woke_from_sleep()) {
		int ret = zmk_buzzer_play_tune(ZMK_BUZZER_TUNE_WAKE, NULL);

		if (ret < 0) {
			LOG_WRN("wake tone failed (%d)", ret);
		}
	}
#endif

	LOG_INF("buzzer ready on %s channel %u (base period %u ns)", tone.dev->name, tone.channel,
		tone.period);

	return 0;
}

SYS_INIT(buzzer_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);

#endif /* DT_HAS_COMPAT_STATUS_OKAY(zmk_buzzer) */
