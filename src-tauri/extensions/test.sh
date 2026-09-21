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
# The share suite checks clip.json against fixtures the Rust importer reads too.
export SHARE_FIXTURES="$HERE/share/Fixtures"
run_suite share "$HERE"/share/Sources/*.swift "$HERE"/share/Tests/*.swift
# The clipper host is built from the share extension's contract and inbox, so a
# clip from a browser is filed exactly like one from the share sheet.
export CLIPPER_FIXTURES="$HERE/clipper/Fixtures"
run_suite clipper \
  "$HERE"/share/Sources/Contract.swift \
  "$HERE"/share/Sources/ShareInbox.swift \
  "$HERE"/share/Sources/ClipDraft.swift \
  "$HERE"/clipper/Sources/ClipperMessages.swift \
  "$HERE"/clipper/Sources/ClipperHost.swift \
  "$HERE"/clipper/Sources/NativeMessaging.swift \
  "$HERE"/clipper/Tests/main.swift
