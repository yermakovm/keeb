#!/usr/bin/env bash
# Build and run the host test for the typing rate
# (keeb-module/boards/shields/keeb/ui/wpm.c).
#
#   tools/wpm_test.sh            # or: make -C zmk-config wpm-test
#
# The rate is a sliding window rolled by whoever samples it, so it is arithmetic
# rather than I/O: the same source file the keyboard links is compiled here with a
# fake clock and run against itself.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out="${TMPDIR:-/tmp}/keeb-wpm-test"

cc -std=c11 -Wall -Wextra -Werror -O1 -g "$here/wpm_test.c" -o "$out"

"$out"
