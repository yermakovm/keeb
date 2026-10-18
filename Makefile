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

BOARD ?= xiao_ble//zmk
DRIVE ?= /Volumes/XIAO-SENSE
# env.mk provides WS, OUT, west on PATH, the SDK vars, ZMK_CONFIG and the two
# in-repo Zephyr modules (module/, status-led/). Sourcing is idempotent, so this
# works both standalone and when env.sh was already sourced.
include env.mk
SDK_ENV = ZEPHYR_TOOLCHAIN_VARIANT=zephyr ZEPHYR_SDK_INSTALL_DIR=$(HOME)/zephyr-sdk-0.16.9
APP = $(WS)/zmk/app
# NB: the in-repo modules must be passed via -DZMK_EXTRA_MODULES (a ';' list),
# NOT via the EXTRA_ZEPHYR_MODULES env var - on Zephyr 4.1 the env var overrides
# ZMK's own ZEPHYR_EXTRA_MODULES and silently drops zmk/app/module (see env.sh).
EXTRA_MODULES = $(KEEB_MODULE);$(STATUS_LED)
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
# made in keeb-module/ or status-led/ — after changing Kconfig/DT files, run
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
	test -d $(DRIVE) || { echo "$(DRIVE) not mounted - double-tap RESET (one half at a time)"; sleep 3; }
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
