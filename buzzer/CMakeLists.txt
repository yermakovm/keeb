# Compile into the `app` target: it carries ZMK's include dirs (zmk/app/include,
# where zmk/behavior.h and drivers/behavior.h live), which a separate
# zephyr_library() target would not get. Same arrangement as status-led/.
#
# Both files are gated by CONFIG_ZMK_BUZZER, and each gates its own body on the
# devicetree: buzzer.c compiles to a "no buzzer on this half" stub when there is
# no zmk,buzzer node, behavior_buzzer.c compiles to nothing when there is no
# zmk,behavior-buzzer node. That is what lets the keeb shield put the buzzer on
# the left half only while the shared keymap still resolves the behavior.
target_sources_ifdef(CONFIG_ZMK_BUZZER app PRIVATE src/buzzer.c src/behavior_buzzer.c)

# Export the public API header to the whole build (behaviors and keyboard
# modules call zmk_buzzer_play_random() from their own sources).
zephyr_include_directories(include)
