# zmk-buzzer

One **passive** buzzer module (**KY-006**, sold as **HW-508**) on one hardware
**PWM** output, plus a behavior that plays a random tone **before** another
action runs.

On keeb it is the left half's reset chord: the chord beeps, then the left half
reboots. See `keeb-module/boards/shields/keeb/keeb_left.overlay` (device +
`&pwm0`), `keeb-module/boards/shields/keeb/keeb.dtsi` (`buzzer_reset`) and
`config/keeb.keymap` (`left_reset_combo`).

## What "passive" means for the firmware

A KY-006 has no oscillator. A static HIGH on its signal pin is **silence**; it
only sounds when the pin is driven with a square wave, and **the frequency of
that wave is the pitch** (usable band ~1.5–2.5 kHz, loudest at its ≈2 kHz
resonance). So:

| | active buzzer (TMB12A03) | **KY-006 (this module)** |
|---|---|---|
| silence | pin LOW | **0 % duty** |
| tone | pin HIGH, one fixed note | square wave, **frequency = pitch** |
| what firmware can shape | rhythm only | rhythm **and pitch** |
| drive circuit | needs a transistor (~30 mA coil) | direct from the pin (piezo load) |

A "sound" here is therefore a rhythm of pulses **with a random pitch per pulse**:
N pulses, each with its own frequency, on-time and gap, drawn per call from the
Kconfig ranges below.

Implementation notes:

- `pwm_set_dt()` per beep: period = `1e9 / freq_hz`, pulse = period ×
  `CONFIG_ZMK_BUZZER_DUTY_PERCENT` / 100. Silence is `pwm_set_dt(spec, period, 0)`,
  which makes the nrfx driver stop the peripheral and park the pad LOW.
- nRF52840 PWM runs off a 16 MHz clock and the Zephyr driver picks a prescaler
  for the requested period, so the peripheral floor is ~30 Hz. The band that
  matters is the piezo's, not the peripheral's.
- Timing runs on one `k_work_delayable`: nothing here sleeps, so the tone
  overlaps typing instead of delaying it.

## Wiring

Two wires:

| KY-006 pin | Connect to | Notes |
|---|---|---|
| **S** | **P1.01** (`&pwm0` channel 0) | signal / square wave |
| **–** | GND | |
| middle | nothing | NC on these boards; some clones label it `+` for an onboard driver stage — not used here |

No transistor, no flyback diode, no pull-down: a piezo disc is a small
capacitive load, and the module boards carry their own pull-down. That is the
whole reason to use this module instead of the previous TMB12A03 — the active
buzzer needed a 2 N7002 low-side stage because its coil wanted ~30 mA against a
~13 mA nRF52840 pin rating.

**Pin:** P1.01 is *not* one of the Pro Micro D-labels in the board file
(`arduino_pro_micro_pins.dtsi`) — it is a spare pad, so follow the board
silkscreen, not a D-number. See [`keeb` pinout](../keeb-module/readme.md).

Volume: the KY-006 is quoted at 1.5–15 V (5 V typical) and the nRF52840 swings
0–3.3 V, so expect a clear but not loud beep. If it is too quiet, the fix is a
bigger swing, not more current — e.g. the disc between 5 V and the drain of a
2 N7002 whose gate is driven by P1.01 through 1 kΩ (with a 100 kΩ gate
pull-down so it stays silent while the pad is floating or disconnected).

## Devicetree

Device + PWM routing (left half only —
`keeb-module/boards/shields/keeb/keeb_left.overlay`):

```dts
/ {
    buzzer_dev: buzzer {
        compatible = "zmk,buzzer";
        /* 2 kHz base period = the ~2 kHz resonance of a KY-006. The driver
         * overrides the period per beep (that is the pitch); this value is the
         * reference used for the 0%-duty silence calls. */
        pwms = <&pwm0 0 PWM_USEC(500) PWM_POLARITY_NORMAL>;

        /* Sounds this half makes without any keymap binding: which layers get
         * announced, and whether a wake from sleep beeps. */
        beep-layers = <KEEB_LAYER_GAME>;
        beep-on-wake;
    };
};

/* Pinctrl state groups must go inside the board's existing pin controller node
 * (label `pinctrl`, node `pin-controller`, compatible nordic,nrf-pinctrl, from
 * zephyr/dts/common/nordic/nrf_common.dtsi) - the same way nice_nano-pinctrl.dtsi
 * adds uart0_default/i2c0_default. Writing `/ { pinctrl { ... } }` creates a
 * second, unrelated node and the PWM driver fails to build its pinctrl table. */
&pinctrl {
    buzzer_pwm_default: buzzer_pwm_default {
        group1 { psels = <NRF_PSEL(PWM_OUT0, 1, 1)>; };   /* P1.01 */
    };

    buzzer_pwm_sleep: buzzer_pwm_sleep {
        group1 {
            psels = <NRF_PSEL(PWM_OUT0, 1, 1)>;           /* P1.01 */
            low-power-enable;
        };
    };
};

&pwm0 {
    status = "okay";                                       /* disabled in nrf52840.dtsi */
    pinctrl-0 = <&buzzer_pwm_default>;
    pinctrl-1 = <&buzzer_pwm_sleep>;
    pinctrl-names = "default", "sleep";
};
```

Behavior node (shared, because `config/keeb.keymap` compiles on both halves and
the combo references it there too — `keeb.dtsi`):

```dts
/ {
    behaviors {
        buzzer_reset: buzzer_reset {
            compatible = "zmk,behavior-buzzer";
            target = <&sys_reset>;   /* omit for a sound-only behavior */
            #binding-cells = <0>;
        };

        buzzer_boot: buzzer_boot {
            compatible = "zmk,behavior-buzzer";
            target = <&bootloader>;
            tune = "bootloader";     /* default is "random" */
            #binding-cells = <0>;
        };
    };
};
```

Keymap use:

```dts
combos {
    compatible = "zmk,combos";

    left_reset_combo {
        key-positions = <KEEB_POS_L_TOP_0 KEEB_POS_L_TOP_1>;
        bindings = <&buzzer_reset>;
        layers = <KEEB_LAYER_HOME>;
        timeout-ms = <100>;
        require-prior-idle-ms = <200>;
    };

    left_boot_combo {
        key-positions = <KEEB_POS_L_TOP_0 KEEB_POS_L_TOP_2>;
        bindings = <&buzzer_boot>;
        layers = <KEEB_LAYER_HOME>;
        timeout-ms = <100>;
        require-prior-idle-ms = <200>;
    };
};
```

`CONFIG_PWM` has no `default y` in Zephyr and the nrfx PWM driver sits behind it,
so `CONFIG_ZMK_BUZZER` selects it. On a half with no enabled `nordic,nrf-pwm`
node that select costs nothing (`CONFIG_PWM_NRFX` depends on the node existing).

## Tunes

A **random** pattern says "something happened". A **named tune** says which one,
which is what you want for events that repeat: a layer flipping, the bootloader
chord, an update the configurator pushed. A tune is a fixed list of
`(pitch, on-time, gap)` steps, with the pitch written as a **percentage of
`CONFIG_ZMK_BUZZER_TUNE_BASE_HZ`** — so a tune is a shape, and moving the base
re-tunes the whole vocabulary to the piezo on your board instead of rewriting
the tables.

| Tune | Shape | Pitch at base 2000 Hz | Length | Who plays it |
|---|---|---|---|---|
| `random` (default) | 2–3 beeps, random rhythm | 1800–2400 Hz, redrawn per beep | 170–540 ms | `left_reset_combo` (`&buzzer_reset`) |
| `layer_on` | two rising notes | 1800 → 2300 | 155 ms | entering GAME (`beep-layers`) |
| `layer_off` | the same two notes upside down | 2300 → 1800 | 155 ms | leaving GAME (`beep-layers`) |
| `bootloader` | three falling notes | 2400 → 2000 → 1600 | 280 ms | `left_boot_combo` (`&buzzer_boot`) |
| `update_ok` | short bright rising ding | 2100 → 2500 | 190 ms | TLV engine, ACK status OK |
| `update_fail` | two low thuds | 1600, 1600 | 360 ms | TLV engine, ACK status ERR |
| `wake` | brief soft two-step | 1900 → 2400 | 110 ms | wake from sleep (`beep-on-wake`) |

Length is the sum of on-times and gaps, and it is what the behavior node waits
before running its `target`.

Why these shapes:

- **Rising means "on / accepted", falling means "off / refused"** — and
  `layer_on`/`layer_off` are literally the same two notes reversed, so the pair
  is learnable as one idea rather than two sounds.
- **`bootloader` is not the random pattern the reset chord uses.** Mixing up
  "reboot" and "reboot into the UF2 bootloader" is how people conclude a keyboard
  is bricked; the sound is the cheapest way to make those two chords
  distinguishable without looking at the screen.
- **`update_fail` is the longest and the lowest tune here.** It is the one that
  is allowed to be annoying, and a low pitch is what "no" sounds like on a
  piezo. `update_ok` is short and bright because it fires on every save you make.
- **`wake` is the shortest.** It plays on every wake from sleep, including the one
  in the middle of a work session; a long or loud wake tone is the tone you end
  up disabling.
- **Reads stay silent.** The TLV engine only tones for records that change the
  keyboard (`CELLS_SET`, the layer verbs, `SAVE`/`DISCARD`/`RESET`) and for every
  refusal — a beep per query would make the board sound busy all session, and the
  display's live-preview writes already answer on screen. See
  `keeb_type_is_update()` in `keeb-module/engine/keeb_engine.c`.
- A tune is at most **3 steps** with gaps ≤ 80 ms: on a 3.3 V piezo, long gaps
  read as a device glitch rather than as rhythm.

Adding one: append a `tune_xxx[]` table and a `tunes[]` entry in `buzzer/src/buzzer.c`,
the matching name in `zmk_buzzer_tune_by_name()`, the enum in
`buzzer/include/zmk/buzzer.h`, and the name in the `enum` list of
`buzzer/dts/bindings/behaviors/zmk,behavior-buzzer.yaml`. The four lists are the
same vocabulary in four places; `BUZZER_SEQ_MAX` grows with the tables on its own.

## Why "sound then reset" is a behavior and not two bindings

`zmk/app/src/combo.c` gives a combo **one** behavior binding (`struct combo_cfg`
holds a single `behavior`, taken from `bindings[0]`), and ZMK's
`behavior_reset.c` calls `sys_reboot()` inside its callback. So a chord bound to
`&sys_reset` is rebooting before anything can sound, and `bindings = <&buzzer
&sys_reset>` is not a thing a combo can express.

`zmk,behavior-buzzer` therefore does both jobs: it starts the tune on its work
queue, reads back the tune's length, and re-invokes its `target` on a delayable
work item `length + CONFIG_ZMK_BUZZER_LEAD_MS` later. The keyboard is fully live
during the tone.

Blocking in the callback instead (`k_sleep` while beeping) would stall ZMK's
behavior queue — every other behavior, including the next keypress — for the
length of the tone. Not done.

On a half with no `zmk,buzzer` node the tone call returns `-ENODEV` and the
target runs at once: the shared keymap still resolves, the chord still works, it
just has no sound.

## Sleep

The nRF52840 keeps its pad state through System OFF — the same trait the matrix
wake-up uses here. A pad left being driven at 2 kHz would keep the disc singing
while the half is "off". Three things prevent that:

1. the driver cancels any pattern and sets 0 % duty on the SLEEP activity state
   (which ZMK raises before powering down) and refuses to start a tone while
   suspended (`-EAGAIN`);
2. `&pwm0`'s `sleep` pinctrl state (`low-power-enable`) disconnects the pad on a
   PM suspend;
3. silence is 0 % duty, which the nrfx driver implements by stopping the
   peripheral and writing the pad LOW.

Keep all three if you patch the driver.

`beep-on-wake` is what turns the other side of that into a sound: ZMK sleeps with
`sys_poweroff()`, which on this SoC is System OFF — RAM is gone and the wake is a
cold boot, so the only thing that still knows is `POWER.RESETREAS`. The driver
reads it once at init and clears only the `OFF` bit (woke from System OFF on a
GPIO DETECT event, i.e. a key press), so `&sys_reset` / `&bootloader` — which set
`SREQ` — are not mistaken for a wake, and other reset reasons stay readable for
anything else that wants them.

## Kconfig

`CONFIG_ZMK_BUZZER=y` (shared `config/keeb.conf`; the device node decides which
half actually has a buzzer).

| Option | Default | Meaning |
|---|---|---|
| `ZMK_BUZZER_PULSES_MIN` / `_MAX` | 2 / 3 | beeps in a random pattern (`_MAX` also sizes the pattern buffer) |
| `ZMK_BUZZER_ON_MS_MIN` / `_MAX` | 45 / 120 | length of one beep |
| `ZMK_BUZZER_GAP_MS_MIN` / `_MAX` | 40 / 90 | gap between beeps |
| `ZMK_BUZZER_FREQ_MIN_HZ` / `_MAX` | 1800 / 2400 | pitch of each random beep, drawn independently per beep |
| `ZMK_BUZZER_DUTY_PERCENT` | 50 | tone duty cycle; lowering it only makes the tone quieter |
| `ZMK_BUZZER_TUNE_BASE_HZ` | 2000 | the pitch every named tune is written relative to (see **Tunes**) |
| `ZMK_BUZZER_LEAD_MS` | 60 | pause between the end of the tone and the `target` behavior |

Worst case with the defaults: 3 beeps × 120 ms + 2 gaps × 90 ms = 540 ms of tone,
so the reset lands ~0.6 s after the chord. Lower `_MAX`/`_LEAD_MS` for a snappier
chord.

## C API (`zmk/buzzer.h`)

```c
enum zmk_buzzer_tune { ZMK_BUZZER_TUNE_RANDOM, … };   /* one per tune name */

int  zmk_buzzer_play(uint8_t pulses, uint16_t on_ms, uint16_t gap_ms, uint16_t freq_hz);
                       /* freq_hz 0 = random pitch per beep */
int  zmk_buzzer_play_tune(enum zmk_buzzer_tune tune, uint32_t *duration_ms);
                       /* out: tune length in ms, so a caller can schedule after it */
int  zmk_buzzer_play_random(uint32_t *duration_ms);   /* == play_tune(RANDOM, …) */
int  zmk_buzzer_tune_by_name(const char *name);       /* DT string -> enum, -1 if unknown */
void zmk_buzzer_stop(void);
bool zmk_buzzer_busy(void);
```

All non-blocking. `0`, `-ENODEV` (no device on this half), `-EAGAIN` (sleeping),
`-EINVAL`. Requested pitches are clamped to 200–8000 Hz.
