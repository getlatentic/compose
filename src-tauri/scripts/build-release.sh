#!/bin/bash
# Build the signed + notarized Compose.app + .dmg artifacts for distribution —
# TWO targets:
#   • arm64 (aarch64-apple-darwin) — a lean Apple-Silicon build (~half the size)
#   • universal (universal-apple-darwin) — arm64 + x86_64, the "any Mac" build
# The auto-updater serves arm64 to Apple Silicon and universal to Intel
# (see make-update-manifest.sh). Each target gets its own bundled runtime arch
# via fetch-runtime.sh (COMPOSE_RUNTIME_ARCH), and its updater tarball is renamed
# per-target so both can ship in one GitHub Release.
#
# Tauri signs the app/frameworks/main binary then notarizes + staples, driven by
# the env vars below; fetch-runtime.sh (beforeBuildCommand) signs the bundled
# node/uv/uvx Tauri leaves untouched. Credentials come from the environment or
# src-tauri/.env.release (gitignored — copy .env.release.example). Required:
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
# The Aptabase analytics key (if set) bakes into the Rust plugin at compile time.
[ -n "${COMPOSE_APTABASE_KEY:-}" ] && export COMPOSE_APTABASE_KEY

# Optional updater signing (separate from Apple signing). When
# TAURI_SIGNING_PRIVATE_KEY is set (the key content or a path, from
# `tauri signer generate`), the build also emits the signed updater artifacts
# (Compose.app.tar.gz + .sig) the auto-updater downloads. Unset → a plain
# release with no updater artifacts (the app still works; it just won't
# self-update). The matching public key goes in tauri.conf.json `plugins.updater`.
UPDATER_CONFIG=()
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] || [ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
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
# leftover `rw.*.dmg` temps those abandon. $1 = the target's bundle dir.
clean_dmg_state() {
  hdiutil detach /Volumes/Compose -force >/dev/null 2>&1 || true
  hdiutil info \
    | awk '/^image-path/{ours=($0 ~ /Compose.*\.dmg/)} ours && /\/dev\/disk[0-9]+/{print $1; ours=0}' \
    | while read -r dev; do hdiutil detach "$dev" -force >/dev/null 2>&1 || true; done
  find "$1" -name 'rw.*.dmg' -delete 2>/dev/null || true
}

# Build + sign + notarize one target. Args: <runtime-arch> <target-triple> <label>.
# The label names the updater tarball (Compose_<label>.app.tar.gz) so both
# targets coexist in one Release; it matches the updater platform key family.
build_one() {
  local runtime_arch="$1" target="$2" label="$3"
  local bundle="$ROOT/target/$target/release/bundle"
  echo ""
  echo "[release] ===== $label  ($target, runtime=$runtime_arch) ====="
  export COMPOSE_RUNTIME_ARCH="$runtime_arch"

  # Force a fresh frontend re-embed. Tauri bakes `dist/` into the binary via
  # `generate_context!` (lib.rs) at COMPILE time, but Cargo won't recompile
  # lib.rs for a frontend-only `dist/` change — an incremental build can ship a
  # STALE embedded frontend that still signs + notarizes. Touching lib.rs forces
  # the recompile (also re-reads the per-target runtime).
  touch "$ROOT/src-tauri/src/lib.rs"

  # create-dmg (bundle_dmg.sh) is intermittently racy (hdiutil/DiskArbitration);
  # clean disk-image state and retry a few times — a transient race clears, a
  # real error (compile failure) fails every attempt fast.
  local built=0 attempt
  for attempt in 1 2 3; do
    clean_dmg_state "$bundle"
    if ( cd "$ROOT" && pnpm tauri build --target "$target" ${UPDATER_CONFIG[@]+"${UPDATER_CONFIG[@]}"} ); then
      built=1; break
    fi
    echo "[release] $label attempt $attempt failed — cleaning disk-image state and retrying…" >&2
  done
  [ "$built" = 1 ] || { echo "[release] $label build failed after 3 attempts" >&2; exit 1; }

  local app="$bundle/macos/Compose.app"
  local node="$app/Contents/Resources/runtime/node/bin/node"
  local dmg; dmg=$(ls "$bundle"/dmg/*.dmg 2>/dev/null | head -1) || true

  # Tauri notarizes + staples the .app but only signs the .dmg wrapper. The DMG
  # is the downloaded artifact, so notarize + staple it too (offline Gatekeeper).
  if [ -n "$dmg" ]; then
    echo "[release] notarizing $label .dmg (waits on Apple)…"
    xcrun notarytool submit "$dmg" \
      --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
    xcrun stapler staple "$dmg"
  fi

  echo "[release] verifying $label app signature + staple…"
  codesign --verify --deep --strict --verbose=2 "$app"
  # Bundled node is a Resource Tauri doesn't sign — prove our pre-sign held.
  codesign -dvv "$node" 2>&1 | grep -E 'Authority=Developer ID|flags=' || true
  spctl -a -t exec -vvv "$app" 2>&1 || true
  xcrun stapler validate "$app" 2>&1 || true
  [ -n "$dmg" ] && xcrun stapler validate "$dmg" 2>&1 || true

  # Per-target updater tarball name so both targets ship in one Release.
  if [ -f "$bundle/macos/Compose.app.tar.gz" ]; then
    cp "$bundle/macos/Compose.app.tar.gz" "$bundle/macos/Compose_$label.app.tar.gz"
    cp "$bundle/macos/Compose.app.tar.gz.sig" "$bundle/macos/Compose_$label.app.tar.gz.sig"
  fi
  echo "[release] $label artifacts:"
  [ -n "$dmg" ] && echo "  $dmg"
  [ -f "$bundle/macos/Compose_$label.app.tar.gz" ] && echo "  $bundle/macos/Compose_$label.app.tar.gz (+ .sig)"
}

echo "[release] building, signing + notarizing both targets — several minutes (notarization waits on Apple)…"
build_one arm64 aarch64-apple-darwin aarch64
build_one universal universal-apple-darwin universal
echo ""
echo "[release] done. Next: make-update-manifest.sh, then create the GitHub Release."
