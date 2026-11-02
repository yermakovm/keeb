#!/bin/sh
# Build one half and print only errors / memory usage.
#   ./build.sh right|left [extra make args]
#
# No module sync step: the shield/behaviors live in this repo as keeb-module/
# (plus status-led/ and buzzer/), all handed to ZMK through -DZMK_EXTRA_MODULES
# (see env.sh / env.mk), so whatever is in those directories today is what gets
# built.
set -e
cd "$(dirname "$0")"
. ./env.sh
side=${1:-right}
shift || true
if make "$side" "$@" > "/tmp/keeb_$side.log" 2>&1; then
  echo "BUILD OK: $side"
  grep -E "Memory region|flash_binary|zephyr.elf" -A 3 "/tmp/keeb_$side.log" | head -12
else
  echo "BUILD FAILED: $side (full log: /tmp/keeb_$side.log)"
  grep -E "error:|Error|FAILED:" "/tmp/keeb_$side.log" | grep -v "^/.*gcc " | head -25
fi
