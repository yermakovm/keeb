# Build + flash the two keyboard halves.
#   make left         build left (central)     -> ../out/left
#   make right        build right (peripheral) -> ../out/right
#   make flash-left   build + copy UF2 (half must be in bootloader mode,
#                     and only one half connected at a time - both mount
#                     the same "XIAO-SENSE" drive)
#   make flash-right  same for the right half
#   make monitor      USB serial console (/dev/cu.keeb*)
#   make tlv-test     run the TLV codec host test (no keyboard needed)
#   make clean        drop the build trees
#
# Run from anywhere: make -C ~/src/keyboard-zmk/zmk-config left
# (build trees live in the workspace, not in this repo: ../out/{left,right})

# nice!nano, v2.0.0 revision.
#
# These boards switch the VCC rail (the 3 V supply the nice!view and the
# KY-016 hang off) from P0.13, and the board manual says P0.13 HIGH = VCC on.
# That is the @2.0.0 polarity (control-gpios = GPIO_ACTIVE_HIGH); @1.0.0
# declares GPIO_ACTIVE_LOW, so ZMK's ext-power driver - which enables at
# boot - would drive P0.13 LOW and cut VCC: display and RGB dark, no supply.
# Verified in the built tree: out/*/zephyr/zephyr.dts control-gpios is
# <&gpio0 0xd 0x1> (ACTIVE_LOW) on @1.0.0 and <&gpio0 0xd 0x0> (ACTIVE_HIGH)
# on @2.0.0.
#
# @2.0.0 also matches what keeb.dtsi already does for the battery
# (zmk,battery-nrf-vddh; there is no P0.04 divider on these boards) and adds
# init-delay-ms = 50 to ext-power. It does NOT match on power mode: @2.0.0
# enables &reg0 for the VDDH->VDD buck, which these clones do not have -
# keeb.dtsi disables it again, see "regulator stages" in keeb-module/readme.md.
# Symptom of the wrong revision: display + RGB dead (VCC off) or a battery
# level that reads 0%/stuck.
BOARD ?= nice_nano@2.0.0//zmk
# UF2 drive name is set by the bootloader, not by this repo: nice!nano and the
# Pro Micro nRF52840 clones mount NICENANO, a genuine nice!nano may mount
# NAKED, the old XIAO-footprint boards mounted XIAO-SENSE. The first one that
# is actually mounted wins (evaluated when the copy runs, not when make
# parses). Pin it explicitly with: make flash-left DRIVE=/Volumes/<name>
DRIVE_CANDIDATES ?= /Volumes/NICENANO /Volumes/NAKED /Volumes/XIAO-SENSE
DRIVE ?= $(firstword $(wildcard $(DRIVE_CANDIDATES)))
# env.mk provides WS, OUT, west on PATH, the SDK vars, ZMK_CONFIG and the three
# in-repo Zephyr modules (keeb-module/, status-led/, buzzer/). Sourcing is
# idempotent, so this works both standalone and when env.sh was already sourced.
include env.mk
SDK_ENV = ZEPHYR_TOOLCHAIN_VARIANT=zephyr ZEPHYR_SDK_INSTALL_DIR=$(HOME)/zephyr-sdk-0.16.9
APP = $(WS)/zmk/app
# NB: the in-repo modules must be passed via -DZMK_EXTRA_MODULES (a ';' list),
# NOT via the EXTRA_ZEPHYR_MODULES env var - on Zephyr 4.1 the env var overrides
# ZMK's own ZEPHYR_EXTRA_MODULES and silently drops zmk/app/module (see env.sh).
EXTRA_MODULES = $(KEEB_MODULE);$(STATUS_LED);$(BUZZER)
COMMON = -s $(APP) -b $(BOARD) -d $(BUILD_DIR) -- \
         -DSHIELD=$(SHIELD) -DZMK_CONFIG=$(ZMK_CONFIG) -DZMK_EXTRA_MODULES="$(EXTRA_MODULES)"

.PHONY: left right flash-left flash-right monitor tlv-test clean

# The TLV codec is the one part of the live-keymap feature that is verifiable
# without a keyboard attached: framing, fragmentation, reassembly, CRC and the
# malformed-input paths are plain C, so tools/tlv_test.sh compiles the firmware
# source (keeb-module/proto/keeb_tlv.c) for the host and runs it against a real
# receiver. Run it after touching the codec or the protocol header.
tlv-test:
	@tools/tlv_test.sh

clean:
	rm -rf $(OUT)/left $(OUT)/right $(OUT)/nodisp

# NB: incremental rebuilds don't reliably pick up Kconfig/devicetree changes
# made in keeb-module/, status-led/ or buzzer/ — after changing Kconfig/DT files, run
# `make clean` first, or the build will silently reuse stale config.
# (Also required whenever BOARD/ZMK_CONFIG/module paths change - ZMK warns
# "The build directory must be cleaned pristinely when changing user ZMK
# config", zmk/app/keymap-module/modules.cmake.)

left:
	BUILD_DIR=$(OUT)/left $(MAKE) _build SHIELD=keeb_left

right:
	BUILD_DIR=$(OUT)/right $(MAKE) _build SHIELD=keeb_right

_build:
	unset EXTRA_ZEPHYR_MODULES; \
	$(SDK_ENV) west build $(COMMON)

# The bootloader ejects the drive as soon as the write lands, so a cp error
# with a vanished drive means success; retry is for macOS mount racing.
define _uf2_copy
	test -d $(DRIVE) || { echo "no UF2 drive mounted (looked for: $(DRIVE_CANDIDATES)) - double-tap RESET, one half at a time, or pass DRIVE=/Volumes/<name>"; sleep 3; }
	test -d $(DRIVE) || { echo "still not mounted"; exit 1; }
	ok=""; \
	for i in 1 2 3; do \
	  if cp $(1)/zephyr/zmk.uf2 $(DRIVE)/ 2>/dev/null; then ok=yes; break; fi; \
	  if [ ! -d $(DRIVE) ]; then ok=yes; echo "drive ejected mid-copy - flash accepted"; break; fi; \
	  echo "retry $$i..."; sleep 2; \
	  [ -d $(DRIVE) ] || { ok=yes; echo "drive ejected - flash accepted"; break; }; \
	done; \
	[ "$$ok" = yes ] || { echo "copy failed - see error above"; exit 1; }; \
	echo "flashed $(1)"
endef

flash-left: left
	$(call _uf2_copy,$(OUT)/left)

flash-right: right
	$(call _uf2_copy,$(OUT)/right)

monitor:
	@test -e /dev/cu.debug-console || { echo "/dev/cu.debug-console not present - is a half plugged in via USB?"; exit 1; }
	screen /dev/cu.usbmodem* 115200
