/*
 * zmk-buzzer - public API.
 *
 * One passive buzzer module (KY-006 / HW-508 piezo) on one hardware PWM
 * output. A passive piezo has no oscillator: a static HIGH is silence, so the
 * driver emits a square wave and the frequency it emits is the pitch.
 * Everything here is asynchronous - the pattern runs on a delayable work item,
 * so a caller never waits for a beep and no key handling is delayed.
 *
 * A "sound" is a rhythm of pulses with their own pitch: N pulses of `on_ms`,
 * separated by `gap_ms`, each at `freq_hz` (or a random pitch per pulse). The
 * trailing gap is not played, so the real length of a pattern is
 *   N * on_ms + (N - 1) * gap_ms
 * which is what zmk_buzzer_play_random() reports back - zmk,behavior-buzzer
 * uses that number to schedule the behavior that follows the tone.
 *
 * Return codes, all functions:
 *   0       started / done
 *   -ENODEV no zmk,buzzer node in this half's devicetree, or its PWM device is not ready
 *   -EAGAIN the keyboard is in the SLEEP activity state (ZMK is about to power
 *           down; nothing may drive the buzzer then - see README, the SoC keeps
 *           its pad state through System OFF)
 *   -EINVAL invalid arguments, or an unknown tune name
 */

#pragma once

#include <stdbool.h>
#include <stdint.h>

/* Fixed pattern: `pulses` beeps, each `on_ms` long, `gap_ms` apart.
 * `pulses` above CONFIG_ZMK_BUZZER_PULSES_MAX is clamped, not rejected.
 * `freq_hz` is the pitch of every beep; 0 means "draw a random pitch per beep"
 * from CONFIG_ZMK_BUZZER_FREQ_MIN_HZ..MAX_HZ. Out-of-range values are clamped
 * to 200..8000 Hz (the piezo is only useful over roughly 1.5-2.5 kHz). */
int zmk_buzzer_play(uint8_t pulses, uint16_t on_ms, uint16_t gap_ms, uint16_t freq_hz);

/* Random pattern: pulse count / on-time / gap / pitch drawn from the
 * CONFIG_ZMK_BUZZER_*_MIN / _MAX pairs, with an independent pitch per beep. If
 * `duration_ms` is not NULL it receives the pattern length in ms. Replaces a
 * pattern already playing. Same thing as zmk_buzzer_play_tune(ZMK_BUZZER_TUNE_RANDOM, ..). */
int zmk_buzzer_play_random(uint32_t *duration_ms);

/* Named tunes: fixed rhythms with fixed pitches, so a sound can mean something.
 *
 * Every tune is a short sequence of (pitch, on-time, gap) steps. Pitches are
 * percentages of CONFIG_ZMK_BUZZER_TUNE_BASE_HZ, which defaults to the KY-006's
 * ~2 kHz resonance - move the base and the whole vocabulary moves with it, so a
 * piezo that is loudest at 2.4 kHz needs one Kconfig value changed, not six
 * tunes rewritten. See buzzer/README.md for the shape of each tune and why it is
 * shaped that way.
 *
 * The names are the `tune` enum of the zmk,behavior-buzzer binding and the
 * argument of zmk_buzzer_tune_by_name(); this enum is only the C side of them. */
enum zmk_buzzer_tune {
	/* Random rhythm and random pitch: no meaning, just a notification. */
	ZMK_BUZZER_TUNE_RANDOM,
	/* A layer this board was told to announce (see `beep-layers`) turned on. */
	ZMK_BUZZER_TUNE_LAYER_ON,
	/* ... and turned off. */
	ZMK_BUZZER_TUNE_LAYER_OFF,
	/* The bootloader chord: this is the last sound before the app is gone. */
	ZMK_BUZZER_TUNE_BOOTLOADER,
	/* A keymap/display update over the TLV engine was accepted. */
	ZMK_BUZZER_TUNE_UPDATE_OK,
	/* ... and was refused. */
	ZMK_BUZZER_TUNE_UPDATE_FAIL,
	/* Woke from ZMK sleep (System OFF), which on this SoC is a cold boot. */
	ZMK_BUZZER_TUNE_WAKE,

	ZMK_BUZZER_TUNE_COUNT,
};

/* Play a named tune. Same rules as zmk_buzzer_play_random(): asynchronous, and
 * it replaces a pattern already playing. `duration_ms` receives the tune's
 * length, which is what zmk,behavior-buzzer uses to schedule the behavior that
 * follows the tone. ZMK_BUZZER_TUNE_RANDOM is accepted here and draws a fresh
 * random pattern (so its length is only known once drawn). */
int zmk_buzzer_play_tune(enum zmk_buzzer_tune tune, uint32_t *duration_ms);

/* Map a tune name ("layer_on", "bootloader", ...) to the enum. Returns
 * -EINVAL for a name this build does not have. Works on a half with no buzzer
 * too: the name is valid, only the playing is not. */
int zmk_buzzer_tune_by_name(const char *name);

/* Silence now: cancel any pending pattern and set the output to 0% duty. */
void zmk_buzzer_stop(void);

/* True while a pattern still has work queued. */
bool zmk_buzzer_busy(void);
