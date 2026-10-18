# ZMK workspace environment - Make side. Lives in this repo, next to the Makefile
# that includes it. ../env.sh (workspace root) is a one-line forwarder that
# sources ./env.sh for interactive shells.
#
# Everything this keyboard AUTHORS lives in this repo, in three labelled zones:
#   config/      keeb.keymap + keeb.conf   -> ZMK user config (what the keys do)
#   keeb-module/ shield, behaviors, status screen -> Zephyr module
#   status-led/  RGB status LED driver     -> Zephyr module (was zmk-status-led/)
# Everything upstream (zephyr/, zmk/, modules/, optional/) stays in the west
# workspace as a sibling, never inside this repo. Build trees go to ../out/.
#
# Keep in sync with env.sh; when editing one, edit the other.

HERE := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
WS   ?= $(abspath $(HERE)/..)

# Zephyr modules handed to ZMK via -DZMK_EXTRA_MODULES (NOT the
# EXTRA_ZEPHYR_MODULES env var - env.sh explains why that breaks Zephyr 4.1).
KEEB_MODULE ?= $(HERE)/keeb-module
STATUS_LED  ?= $(HERE)/status-led
ZMK_CONFIG  ?= $(HERE)/config
OUT         ?= $(WS)/out
export KEEB_MODULE STATUS_LED ZMK_CONFIG OUT

# venv with west; prepended so an already-sourced env.sh changes nothing.
PATH := $(HOME)/.venv-zephyr/bin:$(PATH)
export PATH
