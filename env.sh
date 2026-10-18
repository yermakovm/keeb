# ZMK workspace environment for the keeb split - shell side.
#
# This file lives in the keyboard repo (zmk-config/). The workspace root keeps a
# one-line forwarder, so `source ~/src/keyboard-zmk/env.sh` still works.
#
#   source ./env.sh          (from zmk-config/, or the root forwarder)
#   then either:
#     make -C zmk-config left|right|flash-left|flash-right   <- from the workspace root
#     make left|right                                        <- from this directory
#   or a raw west build from the workspace root:
#     west build -s zmk/app -b xiao_ble//zmk -d out/left  -- -DSHIELD=keeb_left \
#          -DZMK_CONFIG="$ZMK_CONFIG" -DZMK_EXTRA_MODULES="$KEEB_MODULE;$STATUS_LED"
#
# What it provides:
#   PATH                                    venv with west + the python deps Zephyr needs
#   ZEPHYR_TOOLCHAIN_VARIANT / _SDK_INSTALL_DIR
#                                           ARM GCC SDK used by Zephyr 4.1
#   ZMK_CONFIG                              <repo>/config - keeb.conf / keeb.keymap.
#                                           Unset => ZMK silently uses its own keymaps.
#   KEEB_MODULE, STATUS_LED                 the two Zephyr modules that live in this repo
#                                           (keeb-module/, status-led/), passed to ZMK via
#                                           -DZMK_EXTRA_MODULES as a ';' list, which ZMK
#                                           merges with its own app/module and
#                                           keymap-module inside ZEPHYR_EXTRA_MODULES
#                                           (zmk/app/CMakeLists.txt).
#   OUT                                     workspace-level build tree parent: ../out
#
# Do NOT set the EXTRA_ZEPHYR_MODULES env var: on Zephyr 4.1 zephyr_get() gives the
# ENV scope priority over the app's ZEPHYR_EXTRA_MODULES, so the env var *replaces*
# ZMK's module list and silently drops zmk/app/module (every ZMK_* kscan / split
# Kconfig symbol becomes "undefined"). If it is ever set in a parent shell, unset it.
unset EXTRA_ZEPHYR_MODULES
#
# If the workspace moves, edit ZMK_WS (or export it before sourcing).

export ZMK_WS="${ZMK_WS:-/Users/mykhailoyermakov/src/keyboard-zmk}"
# Derived from ZMK_WS, not from $0/BASH_SOURCE: when this file is *sourced* from
# zsh, $0 is the shell, so self-locating picks the wrong directory.
export ZMK_REPO="${ZMK_REPO:-$ZMK_WS/zmk-config}"

export PATH="$HOME/.venv-zephyr/bin:$PATH"
export ZEPHYR_TOOLCHAIN_VARIANT=zephyr
export ZEPHYR_SDK_INSTALL_DIR="$HOME/zephyr-sdk-0.16.9"

export ZMK_CONFIG="$ZMK_REPO/config"
export KEEB_MODULE="$ZMK_REPO/keeb-module"
export STATUS_LED="$ZMK_REPO/status-led"
export OUT="${OUT:-$ZMK_WS/out}"

# Warnings are cheaper than a confusing build error later.
[ -d "$ZMK_REPO/config" ] || echo "env.sh: no config dir at $ZMK_REPO (wrong ZMK_WS?)" >&2
command -v west >/dev/null 2>&1 || echo "env.sh: west not on PATH (expected ~/.venv-zephyr/bin)" >&2
[ -d "$ZEPHYR_SDK_INSTALL_DIR" ] || echo "env.sh: no SDK at $ZEPHYR_SDK_INSTALL_DIR" >&2
[ -f "$KEEB_MODULE/zephyr/module.yml" ] || echo "env.sh: $KEEB_MODULE is not a Zephyr module" >&2
[ -f "$STATUS_LED/zephyr/module.yml" ] || echo "env.sh: $STATUS_LED is not a Zephyr module" >&2
