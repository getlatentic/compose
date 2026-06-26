#!/bin/bash
# Build the Homebrew-prep installer package.
#
# Produces a scripts-only .pkg whose postinstall creates + chowns the Homebrew
# prefix as root. The app `open`s this at runtime; Apple's Installer
# authenticates the user — no osascript, no privileged-helper daemon.
#
# Signing + notarization are GATED on env vars: this builds an UNSIGNED pkg for
# local testing today, and a Developer-ID-signed + notarized pkg once the cert
# is set up. An unsigned pkg is Gatekeeper-blocked on other machines — only the
# signed + notarized output is shippable.
#
#   DEVELOPER_ID_INSTALLER  e.g. "Developer ID Installer: Your Name (TEAMID)"
#   NOTARY_PROFILE          a notarytool keychain profile, set up once with
#                           `xcrun notarytool store-credentials <profile> \
#                              --apple-id <id> --team-id <team> --password <app-pw>`
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
IDENTIFIER="com.compose.homebrew-prep"
VERSION="1.0.0"
OUT_DIR="${1:-$HERE/build}"
OUT_PKG="$OUT_DIR/homebrew-prep.pkg"

mkdir -p "$OUT_DIR"

build_args=(
  --nopayload
  --scripts "$HERE/scripts"
  --identifier "$IDENTIFIER"
  --version "$VERSION"
)

if [ -n "${DEVELOPER_ID_INSTALLER:-}" ]; then
  echo "[pkg] Signing with: $DEVELOPER_ID_INSTALLER"
  build_args+=(--sign "$DEVELOPER_ID_INSTALLER")
else
  echo "[pkg] WARNING: building UNSIGNED (set DEVELOPER_ID_INSTALLER to sign). Local testing only."
fi

pkgbuild "${build_args[@]}" "$OUT_PKG"
echo "[pkg] Built: $OUT_PKG"

if [ -n "${NOTARY_PROFILE:-}" ]; then
  if [ -z "${DEVELOPER_ID_INSTALLER:-}" ]; then
    echo "[pkg] ERROR: notarization requires a signed pkg (set DEVELOPER_ID_INSTALLER)." >&2
    exit 1
  fi
  echo "[pkg] Submitting for notarization (profile: $NOTARY_PROFILE)…"
  xcrun notarytool submit "$OUT_PKG" --keychain-profile "$NOTARY_PROFILE" --wait
  echo "[pkg] Stapling…"
  xcrun stapler staple "$OUT_PKG"
  echo "[pkg] Notarized + stapled."
else
  echo "[pkg] Skipping notarization (set NOTARY_PROFILE to enable)."
fi
