#!/bin/bash
# Run the extensions' tests. Each suite is a plain executable over its
# extension's own sources — the logic is pure or works in a temporary folder — so
# no bundle, signing or host process is needed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$(mktemp -d)"

# Args: <suite> <swift-file>...
run_suite() {
  local suite="$1"
  shift
  xcrun --sdk macosx swiftc -O "$@" -o "$BIN/$suite"
  "$BIN/$suite"
}

run_suite quicklook \
  "$HERE"/quicklook/Shared/*.swift \
  "$HERE"/quicklook/Preview/Sources/*.swift \
  "$HERE"/quicklook/Thumbnail/Sources/*.swift \
  "$HERE"/quicklook/Tests/main.swift
# The share suite checks clip.json against fixtures the Rust importer reads too,
# and the activation rule against the file types tauri.conf.json declares.
export SHARE_FIXTURES="$HERE/share/Fixtures"
export COMPOSE_CONFIG="$HERE/../tauri.conf.json"
run_suite share "$HERE"/share/Sources/*.swift "$HERE"/share/Activation/ActivationRule.swift \
  "$HERE"/share/Tests/*.swift
