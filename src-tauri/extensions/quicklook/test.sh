#!/bin/bash
# Run the Quick Look renderer's tests. Pure functions — markdown in, HTML out —
# so they need no bundle, no signing and no Quick Look host.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$(mktemp -d)/qltests"
xcrun --sdk macosx swiftc -O "$HERE"/Sources/*.swift "$HERE"/Tests/main.swift -o "$BIN"
"$BIN"
