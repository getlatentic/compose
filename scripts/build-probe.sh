#!/bin/bash
# Build a test copy of Compose ("Compose Probe", its own bundle id, so it
# never shares settings, keys or the share inbox with the installed app) from
# a checkout or worktree, and install it where Spotlight and Launchpad open
# it: ~/Applications/Compose Probe.app.
#
#   scripts/build-probe.sh [checkout]      # default: this checkout
#
# Signs with the Developer ID from src-tauri/.env.release of the main
# checkout (COMPOSE_RELEASE_ENV overrides the path); prints no credential.
# Fails unless the installed binary is the one this run built.
set -euo pipefail

checkout=$(cd "${1:-$(dirname "$0")/..}" && git rev-parse --show-toplevel)
main_checkout=$(git -C "$checkout" worktree list --porcelain | awk '/^worktree /{print $2; exit}')
release_env=${COMPOSE_RELEASE_ENV:-$main_checkout/src-tauri/.env.release}
installed="$HOME/Applications/Compose Probe.app"
built="$checkout/target/aarch64-apple-darwin/release/bundle/macos/Compose Probe.app"

set -a
# shellcheck disable=SC1090
. "$release_env"
set +a
# Signing only: nothing that notarizes, publishes or reports.
unset APPLE_ID APPLE_PASSWORD APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH \
  TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PATH TAURI_SIGNING_PRIVATE_KEY_PASSWORD COMPOSE_APTABASE_KEY
export APPLE_SIGNING_IDENTITY APPLE_TEAM_ID
# The system's own tools first: a `xattr` earlier on PATH without `-r`
# breaks the bundling step.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
# The release build's directory: apart from `cargo test`'s, so the two
# never race, and already warm.
export CARGO_BUILD_BUILD_DIR="$HOME/.cargo/build-dir-compose-release"

free_gb=$(df -g "$HOME" | awk 'NR==2 {print $4}')
if [ "$free_gb" -lt 15 ]; then
  echo "[probe] only ${free_gb} GB free; a release build needs about 15" >&2
  exit 1
fi

config=$(mktemp -t probe-config).json
trap 'rm -f "$config"' EXIT
cat >"$config" <<'JSON'
{
  "identifier": "ai.latentic.compose.probe",
  "productName": "Compose Probe",
  "plugins": { "updater": { "endpoints": ["https://updates.invalid/latest.json"] } }
}
JSON

started=$(date +%s)
# A frontend-only change does not always rebuild the binary that embeds it.
touch "$checkout/src-tauri/src/lib.rs"
(cd "$checkout" && pnpm tauri build --target aarch64-apple-darwin --bundles app --config "$config")

rm -rf "$installed"
ditto "$built" "$installed"
binary_time=$(stat -f %m "$installed/Contents/MacOS/compose")
if [ "$binary_time" -lt "$started" ]; then
  echo "[probe] the installed binary predates this build: $installed" >&2
  exit 1
fi
echo "[probe] OK $installed $(date -r "$binary_time" '+%Y-%m-%d %H:%M:%S')"
