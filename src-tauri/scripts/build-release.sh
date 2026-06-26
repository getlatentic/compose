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

# Optional updater signing (separate from Apple signing). When
# TAURI_SIGNING_PRIVATE_KEY is set (the key content or a path, from
# `tauri signer generate`), the build also emits the signed updater artifacts
# (Compose.app.tar.gz + .sig) the auto-updater downloads. Unset → a plain
# release with no updater artifacts (the app still works; it just won't
# self-update). The matching public key goes in tauri.conf.json `plugins.updater`.
UPDATER_CONFIG=()
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] || [ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
  # Tauri reads the key from either the inline value or a path; the password is
  # optional. Export whichever .env.release set so the build inherits them.
  export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PATH TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  UPDATER_CONFIG=(--config '{"bundle":{"createUpdaterArtifacts":true}}')
  echo "[release] updater signing key set — emitting updater artifacts"
else
  echo "[release] no updater signing key (TAURI_SIGNING_PRIVATE_KEY[_PATH]) — building without updater artifacts"
fi

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

# Clear stale disk-image state that wedges bundle_dmg.sh: a mounted
# /Volumes/Compose, an attached scratch image left by a failed run, and the
# leftover `rw.*.dmg` temps those abandon (they accumulate otherwise). The awk
# tracks the current image-path block and detaches its /dev node when the
# backing file is one of ours.
clean_dmg_state() {
  hdiutil detach /Volumes/Compose -force >/dev/null 2>&1 || true
  hdiutil info \
    | awk '/^image-path/{ours=($0 ~ /Compose.*\.dmg/)} ours && /\/dev\/disk[0-9]+/{print $1; ours=0}' \
    | while read -r dev; do hdiutil detach "$dev" -force >/dev/null 2>&1 || true; done
  find "$ROOT/target/release/bundle" -name 'rw.*.dmg' -delete 2>/dev/null || true
}

# `create-dmg` (bundle_dmg.sh) is intermittently racy here (hdiutil /
# DiskArbitration), so the app can sign + notarize yet the final .dmg step still
# fails. Clean the disk-image state and retry the whole build a few times: a
# transient race clears on a retry, while a real error (e.g. a compile failure)
# fails every attempt fast.
echo "[release] building, signing + notarizing — several minutes (notarization waits on Apple)…"
built=0
for attempt in 1 2 3; do
  clean_dmg_state
  if ( cd "$ROOT" && pnpm tauri build ${UPDATER_CONFIG[@]+"${UPDATER_CONFIG[@]}"} ); then
    built=1
    break
  fi
  echo "[release] attempt $attempt failed — cleaning disk-image state and retrying…" >&2
done
[ "$built" = 1 ] || { echo "[release] build failed after 3 attempts" >&2; exit 1; }

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
