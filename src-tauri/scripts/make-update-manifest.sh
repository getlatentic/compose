#!/bin/bash
# Assemble the updater manifest (latest.json) from the per-target updater tarballs
# build-release.sh produced. The auto-updater (tauri.conf.json `plugins.updater`)
# fetches this; each running arch downloads its own tarball:
#   darwin-aarch64 → the lean arm64 tarball
#   darwin-x86_64  → the universal tarball (runs on Intel)
#
# Run AFTER build-release.sh (with TAURI_SIGNING_PRIVATE_KEY set). Then create the
# GitHub Release v<version> and upload BOTH tarballs (+ .sig), both .dmgs, and
# latest.json as assets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPO="getlatentic/compose" # matches the endpoint in tauri.conf.json

VERSION=$(grep -m1 '"version"' "$ROOT/src-tauri/tauri.conf.json" \
  | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')

ARM_SIG="$ROOT/target/aarch64-apple-darwin/release/bundle/macos/Compose_aarch64.app.tar.gz.sig"
UNI_SIG="$ROOT/target/universal-apple-darwin/release/bundle/macos/Compose_universal.app.tar.gz.sig"
for f in "$ARM_SIG" "$UNI_SIG"; do
  if [ ! -f "$f" ]; then
    echo "missing updater signature: $f" >&2
    echo "run build-release.sh with TAURI_SIGNING_PRIVATE_KEY set first." >&2
    exit 1
  fi
done

# The .sig is a single base64 line; strip any stray newline so the JSON stays valid.
ARM_SIGNATURE=$(tr -d '\n' < "$ARM_SIG")
UNI_SIGNATURE=$(tr -d '\n' < "$UNI_SIG")
BASE="https://github.com/$REPO/releases/download/v$VERSION"
OUT="$ROOT/target/latest.json"

cat > "$OUT" <<JSON
{
  "version": "$VERSION",
  "notes": "See the release notes.",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$ARM_SIGNATURE",
      "url": "$BASE/Compose_aarch64.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "$UNI_SIGNATURE",
      "url": "$BASE/Compose_universal.app.tar.gz"
    }
  }
}
JSON

echo "wrote $OUT (version $VERSION)"
echo "next: upload Compose_aarch64.app.tar.gz + Compose_universal.app.tar.gz (+ their .sig), both .dmgs, and latest.json to Release v$VERSION."
