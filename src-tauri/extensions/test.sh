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
export CONTRACT_FIXTURES="$HERE/shared/Fixtures"
run_suite share "$HERE"/shared/*.swift "$HERE"/share/Sources/*.swift "$HERE"/share/Tests/*.swift
# The clipper host is built from the shared contract and inbox, so a clip from a
# browser is filed exactly like one from the share sheet.
export CLIPPER_FIXTURES="$HERE/clipper/Fixtures"
run_suite clipper \
  "$HERE"/shared/Contract.swift \
  "$HERE"/shared/ShareInbox.swift \
  "$HERE"/shared/ClipDraft.swift \
  "$HERE"/clipper/Sources/ClipperMessages.swift \
  "$HERE"/clipper/Sources/ClipperHost.swift \
  "$HERE"/clipper/Sources/NativeMessaging.swift \
  "$HERE"/clipper/Tests/main.swift
# Everything but each extension's entry point, which the suite's own main replaces.
run_suite intents "$HERE"/shared/*.swift "$HERE"/entities/*.swift "$HERE"/intents/Sources/*.swift "$HERE"/intents/Tests/*.swift
run_suite widget "$HERE"/shared/*.swift "$HERE"/entities/*.swift "$HERE"/widget/Sources/*.swift "$HERE"/widget/Tests/*.swift
run_suite finder "$HERE"/shared/*.swift "$HERE"/finder/Sources/*.swift "$HERE"/finder/Tests/*.swift
