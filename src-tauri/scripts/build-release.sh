#!/bin/bash
# Build a signed + notarized Compose.app + .dmg for distribution.
#
# Tauri signs the app, its frameworks and the main binary and then notarizes +
# staples, all driven by the env vars below. fetch-runtime.sh (run from
# beforeBuildCommand) signs the bundled node/uv/uvx that Tauri leaves untouched,
# using the same APPLE_SIGNING_IDENTITY. This script wires the credentials,
# runs the build, and verifies the output before you ship it.
#
# Credentials come from the environment, or from src-tauri/.env.release
# (gitignored — copy .env.release.example). Required:
#   APPLE_SIGNING_IDENTITY  "Developer ID Application: Name (TEAMID)"
#   APPLE_ID                Apple account email
#   APPLE_PASSWORD          app-specific password from appleid.apple.com
#   APPLE_TEAM_ID           10-character team id
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/src-tauri/.env.release"
if [ -f "$ENV_FILE" ]; then
  echo "[release] loading credentials from src-tauri/.env.release"
  set -a; . "$ENV_FILE"; set +a
fi

missing=()
for v in APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  [ -n "${!v:-}" ] || missing+=("$v")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "[release] missing required env: ${missing[*]}" >&2
  echo "          set them in your shell, or in src-tauri/.env.release (see .env.release.example)." >&2
  exit 1
fi
# Export so the build subprocess + beforeBuildCommand (fetch-runtime.sh) inherit them.
export APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID

# Pre-flight: the identity must resolve to a real codesigning identity.
if ! security find-identity -p codesigning -v | grep -qF "$APPLE_SIGNING_IDENTITY"; then
  echo "[release] '$APPLE_SIGNING_IDENTITY' is not an installed codesigning identity:" >&2
  security find-identity -p codesigning -v >&2
  exit 1
fi

# Tauri runs `xattr -cr` on the bundle before signing; force the system xattr
# ahead of any pip/pyenv `xattr` on PATH (that one rejects -r and fails the
# bundle). Safe here — pnpm/cargo/node resolve from their own PATH entries.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Detach any stale Compose disk image first: a mounted /Volumes/Compose (from a
# prior .dmg, or a leftover rw temp from a failed run) makes bundle_dmg.sh fail
# to create the new one ("failed to run bundle_dmg.sh").
hdiutil detach /Volumes/Compose -force >/dev/null 2>&1 || true
hdiutil info | awk '/^image-path/{i=$0} /^\/dev\/disk[0-9]+[ \t]/{if(i ~ /Compose.*\.dmg/) print $1}' \
  | while read -r dev; do hdiutil detach "$dev" -force >/dev/null 2>&1 || true; done

echo "[release] building, signing + notarizing — several minutes (notarization waits on Apple)…"
( cd "$ROOT" && pnpm tauri build )

# Cargo workspace → target lives at the workspace root, not under src-tauri/.
APP="$ROOT/target/release/bundle/macos/Compose.app"
NODE="$APP/Contents/Resources/runtime/node/bin/node"
DMG=$(ls "$ROOT"/target/release/bundle/dmg/*.dmg 2>/dev/null | head -1) || true

# Tauri notarizes + staples the .app but only signs the .dmg wrapper. The DMG is
# the downloaded artifact, so notarize + staple it too — a stapled ticket lets it
# pass Gatekeeper offline, with no per-open online check.
if [ -n "$DMG" ]; then
  echo "[release] notarizing the .dmg (waits on Apple)…"
  xcrun notarytool submit "$DMG" \
    --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
  xcrun stapler staple "$DMG"
fi

echo "[release] verifying app signature…"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "[release] bundled node (a Resource Tauri doesn't sign — proves our pre-sign held):"
codesign -dvv "$NODE" 2>&1 | grep -E 'Authority=Developer ID|TeamIdentifier|flags='
codesign -d --entitlements - --xml "$NODE" 2>/dev/null | plutil -p - 2>/dev/null \
  | grep -E 'allow-jit|disable-library-validation' || echo "  WARNING: node is missing its entitlements"

echo "[release] Gatekeeper + notarization staple:"
spctl -a -t exec -vvv "$APP" 2>&1 || true
xcrun stapler validate "$APP" 2>&1 || true
[ -n "$DMG" ] && xcrun stapler validate "$DMG" 2>&1 || true

echo "[release] done. Artifacts:"
[ -n "$DMG" ] && echo "  $DMG"
echo "  $APP"
