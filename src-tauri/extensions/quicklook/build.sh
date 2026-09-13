#!/bin/bash
# Build ComposeQuickLook.appex — the Quick Look preview for .md files.
#
# No Xcode project: an app extension is an executable whose entry point is
# Foundation's NSExtensionMain, plus an Info.plist naming the principal class.
# swiftc can produce that directly, which keeps the extension inside the same
# `cargo`/`pnpm` build the rest of the app uses.
#
#   build.sh <output-dir> [arch...]      default arch: the host's
#
# Signed here when APPLE_SIGNING_IDENTITY is set, because Tauri signs the app
# WITHOUT --deep: it seals what it finds, so the extension has to arrive
# already signed with its own entitlements. (--deep would re-sign the .appex
# with the app's entitlements, dropping the sandbox that pluginkit requires —
# an extension without it is not registered at all.)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${1:?usage: build.sh <output-dir> [arch...]}"
shift || true
ARCHS=("$@")
[ "${#ARCHS[@]}" -gt 0 ] || ARCHS=("$(uname -m)")

# The Command Line Tools SDK carries only the legacy QuickLook generator API;
# QLPreviewProvider lives in QuickLookUI, which ships with Xcode.
SDK="$(xcrun --sdk macosx --show-sdk-path)"
if [ ! -d "$SDK/System/Library/Frameworks/QuickLookUI.framework" ]; then
  echo "[quicklook] QuickLookUI is missing from $SDK" >&2
  echo "            Xcode is required: sudo xcode-select -s /Applications/Xcode.app" >&2
  exit 1
fi

# The extension's version has to track the app's: pluginkit keys its registry
# on bundle id + version, so a stale version means an updated preview is never
# picked up.
VERSION="$(/usr/bin/python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" \
  "$HERE/../../tauri.conf.json")"

APPEX="$OUT_DIR/ComposeQuickLook.appex"
rm -rf "$APPEX"
mkdir -p "$APPEX/Contents/MacOS"
cp "$HERE/Info.plist" "$APPEX/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APPEX/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$APPEX/Contents/Info.plist"

# `MACOSX_DEPLOYMENT_TARGET` is 12.0: QLPreviewProvider's floor.
slices=()
for arch in "${ARCHS[@]}"; do
  slice="$(mktemp -d)/ComposeQuickLook-$arch"
  xcrun --sdk macosx swiftc \
    -target "${arch}-apple-macos12.0" \
    -sdk "$SDK" \
    -O -wmo \
    -application-extension \
    -framework QuickLookUI \
    -Xlinker -e -Xlinker _NSExtensionMain \
    -o "$slice" \
    "$HERE"/Sources/*.swift
  slices+=("$slice")
done

if [ "${#slices[@]}" -gt 1 ]; then
  lipo -create "${slices[@]}" -output "$APPEX/Contents/MacOS/ComposeQuickLook"
else
  cp "${slices[0]}" "$APPEX/Contents/MacOS/ComposeQuickLook"
fi

if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  codesign --force --timestamp --options runtime \
    --entitlements "$HERE/ComposeQuickLook.entitlements" \
    --sign "$APPLE_SIGNING_IDENTITY" "$APPEX"
  signed="signed"
else
  signed="unsigned — Quick Look will not load it"
fi

echo "[quicklook] built $APPEX ($(lipo -archs "$APPEX/Contents/MacOS/ComposeQuickLook"), $signed)"
