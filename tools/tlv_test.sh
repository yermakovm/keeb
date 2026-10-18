#!/usr/bin/env bash
# Build and run the host test for the KEEB TLV codec (keeb-module/proto/keeb_tlv.c).
#
#   tools/tlv_test.sh            # or: make -C zmk-config tlv-test
#
# The codec is the one part of the live-keymap feature that can be verified
# without a keyboard attached: framing, fragmentation, reassembly, CRC and the
# malformed-input paths are pure C, so they are compiled for the host here and
# run against themselves (the test's fake link feeds a real receiver).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
proto="$here/../keeb-module/proto"
out="${TMPDIR:-/tmp}/keeb-tlv-test"

mkdir -p "$(dirname "$out")"

cc -std=c11 -Wall -Wextra -Werror -O1 -g \
	-I "$proto" \
	"$here/tlv_test.c" "$proto/keeb_tlv.c" \
	-o "$out"

"$out"
