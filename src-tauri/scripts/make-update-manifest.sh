#!/bin/bash
# Assemble the updater manifest (latest.json) from a release build's signed
# artifacts. The auto-updater endpoint (tauri.conf.json `plugins.updater`) points
# at this file on the GitHub Release; the app compares its version against it.
#
# Run AFTER build-release.sh with TAURI_SIGNING_PRIVATE_KEY set (that emits
# Compose.app.tar.gz + .sig). Then create a GitHub Release tagged v<version> and
# upload BOTH Compose.app.tar.gz and latest.json as assets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MACOS="$ROOT/target/release/bundle/macos"
SIG="$MACOS/Compose.app.tar.gz.sig"
REPO="getlatentic/compose" # matches the endpoint in tauri.conf.json

VERSION=$(grep -m1 '"version"' "$ROOT/src-tauri/tauri.conf.json" \
  | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')

if [ ! -f "$SIG" ]; then
  echo "no updater signature at $SIG" >&2
  echo "run build-release.sh with TAURI_SIGNING_PRIVATE_KEY set first." >&2
  exit 1
fi

# The .sig is a single base64 line; strip any stray newline so the JSON stays valid.
SIGNATURE=$(tr -d '\n' < "$SIG")
URL="https://github.com/$REPO/releases/download/v$VERSION/Compose.app.tar.gz"
OUT="$MACOS/latest.json"

cat > "$OUT" <<JSON
{
  "version": "$VERSION",
  "notes": "See the release notes.",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$SIGNATURE",
      "url": "$URL"
    }
  }
}
JSON

echo "wrote $OUT (version $VERSION)"
echo "next: create GitHub Release v$VERSION and upload Compose.app.tar.gz + latest.json as assets."
