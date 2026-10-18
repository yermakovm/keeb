# Compile into the `app` target: it carries ZMK's include dirs (zmk/app/include),
# which a separate zephyr_library() target would not get.
target_sources_ifdef(CONFIG_ZMK_STATUS_LED app PRIVATE src/status_led.c)

# Export the public API header to the whole build (keyboard modules call
# zmk_status_led_set_layer_color() from their own sources).
zephyr_include_directories(include)
