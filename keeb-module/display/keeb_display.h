/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * The status screen's TLV face: what the config engine may read and write on
 * the panel, and how that survives a reboot.
 *
 * Same rule as keymap/keeb_keymap.c: this is the only file in the module that
 * turns protocol bytes into UI state, and the only one that touches settings for
 * the panel. The engine dispatches to it, the widget model in
 * boards/shields/keeb/ui/ holds the data, and neither sees the other's API.
 *
 * What is persisted mirrors what the keymap persists: the widget table and the
 * host-written strings, in a settings subtree of their own ("keebui"), with the
 * built-in preset as the fallback when nothing is saved. The number slots are
 * not persisted - they are live values a host pushes while it is connected, and
 * a keyboard that has been in System OFF for an hour has no business showing
 * them.
 */

#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "../proto/keeb_tlv.h"

/** KEEB_INFO_F_DISPLAY when this build has a panel the host can edit. */
uint32_t keeb_display_capabilities(void);

/** Fill a keeb_display_info record with this panel's real limits. */
void keeb_display_info(struct keeb_display_info *info);

/** Append one KEEB_T_PRESET_NAME record per built-in preset. */
int keeb_display_names(struct keeb_tlv_msg *msg);

/** Append a KEEB_T_DISPLAY record: header, widgets, then the text and value
 * slots as their own records. One message, the whole panel. */
int keeb_display_dump(struct keeb_tlv_msg *msg);

/** Apply a whole KEEB_T_DISPLAY_SET payload. Validated in full first: a panel
 * is not a place to leave a half-written layout. *applied reports the widget
 * count. */
int keeb_display_set_table(const uint8_t *data, uint16_t len, uint16_t *applied);

/** Apply a KEEB_T_WIDGET_SET (index + one widget) / KEEB_T_TEXT_SET /
 * KEEB_T_VALUE_SET payload. */
int keeb_display_set_widget(const uint8_t *data, uint16_t len);
int keeb_display_set_text(const uint8_t *data, uint16_t len);
int keeb_display_set_value(const uint8_t *data, uint16_t len);

/** Restore a built-in preset (payload optional; empty means preset 0). */
int keeb_display_preset(const uint8_t *data, uint16_t len);

/** Persist / drop / clear the saved panel. */
int keeb_display_save(void);
int keeb_display_discard(void);
int keeb_display_reset(void);

/** Paint the glass blank without touching the saved table. */
int keeb_display_blank(void);

/** True when the running table differs from what is saved. */
bool keeb_display_dirty(void);
