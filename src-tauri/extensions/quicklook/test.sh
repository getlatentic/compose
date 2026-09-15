#!/bin/bash
# Run the Quick Look extensions' tests. The renderers are pure — markdown in,
# HTML or lines out — so they need no bundle, no signing and no Quick Look host.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$(mktemp -d)/qltests"
xcrun --sdk macosx swiftc -O \
  "$HERE"/Shared/*.swift \
  "$HERE"/Preview/Sources/*.swift \
  "$HERE"/Thumbnail/Sources/*.swift \
  "$HERE"/Tests/main.swift \
  -o "$BIN"
"$BIN"
