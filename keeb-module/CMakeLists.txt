# Copyright (c) 2025 The keeb keyboard authors
# SPDX-License-Identifier: MIT
#
# Status screen + power diagnostic sources. A Zephyr module library is linked
# with --whole-archive, so the power SYS_INIT and the behaviour's
# linker-section registrations survive even though nothing references those
# symbols.
#
# NB: zephyr_library() derives its target name from the module, so it can be
# called at most ONCE per CMakeLists - hence the single library with
# conditionally-appended sources below.

set(KEEB_SOURCES)
set(KEEB_UI_DIR boards/shields/keeb/ui)

if(CONFIG_KBEEB_POWER_DIAG)
  list(APPEND KEEB_SOURCES boards/shields/keeb/power.c)
endif()

if(CONFIG_KBEEB_UI)
  list(APPEND KEEB_SOURCES
    ${KEEB_UI_DIR}/keeb_ui.c
    ${KEEB_UI_DIR}/status_screen.c
    ${KEEB_UI_DIR}/widget_model.c
    ${KEEB_UI_DIR}/behavior_layer_art.c
    ${KEEB_UI_DIR}/display_sleep.c
    ${KEEB_UI_DIR}/art/layer_art.c
    ${KEEB_UI_DIR}/art/layer_art_data.c
  )

  if(CONFIG_KBEEB_ADC_DIAG)
    list(APPEND KEEB_SOURCES ${KEEB_UI_DIR}/adc_diag.c)
  endif()

  if(CONFIG_KBEEB_LAYER_LED_INDICATE)
    list(APPEND KEEB_SOURCES ${KEEB_UI_DIR}/layer_indicate.c)
  endif()

  if(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
    list(APPEND KEEB_SOURCES
      ${KEEB_UI_DIR}/panel_central.c
      ${KEEB_UI_DIR}/layer_sync.c
    )
  else()
    list(APPEND KEEB_SOURCES ${KEEB_UI_DIR}/panel_peripheral.c)
  endif()
endif()

# Reboot / bootloader forwarding for right-half combos (see
# boards/shields/keeb/behavior_remote_reset.c). Compiled on both halves:
# the shared keymap references the behavior nodes everywhere.
list(APPEND KEEB_SOURCES boards/shields/keeb/behavior_remote_reset.c)

# Live keymap mutation engine (TLV config channel, no ZMK Studio).
#
# proto/keeb_tlv.c is plain C - the same file is compiled into the keyboard and
# into tools/tlv_test.c on the host, so framing, reassembly and CRC are verified
# without a wrist. The engine applies changes on the system work queue, and the
# BLE transport only hands the engine a send hook.
if(CONFIG_KBEEB_ENGINE)
  list(APPEND KEEB_SOURCES
    proto/keeb_tlv.c
    engine/keeb_engine.c
    keymap/keeb_tokens.c
    keymap/keeb_keymap.c
    # The panel's protocol face: validates a payload before the widget model
    # applies it, and owns the "keebui" settings subtree. Compiled with the
    # engine, and it answers KEEB_ERR_NOT_SUPPORTED when there is no panel.
    display/keeb_display.c
  )

  if(CONFIG_KBEEB_ENGINE_BLE)
    list(APPEND KEEB_SOURCES transport/keeb_ble.c)
  endif()
endif()

if(KEEB_SOURCES)
  zephyr_library()

  # ZMK's own headers (zmk/*.h, drivers/behavior.h) live in the app's include
  # directory, which is not exported to other targets.
  zephyr_library_include_directories(${KEEB_UI_DIR} ${CMAKE_SOURCE_DIR}/include)
  zephyr_library_sources(${KEEB_SOURCES})
endif()