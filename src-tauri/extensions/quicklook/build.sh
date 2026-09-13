#!/bin/bash
# Build the Quick Look extensions — the .md preview (Space in the Finder) and
# the .md thumbnail (the Finder's icon).
#
# No Xcode project: an app extension is an executable whose entry point is
# Foundation's NSExtensionMain, plus an Info.plist naming the principal class.
# swiftc can produce that directly, which keeps the extensions inside the same
# build the rest of the app uses.
#
#   build.sh <output-dir> [arch...]      default arch: the host's
#
# Signed here when APPLE_SIGNING_IDENTITY is set, because Tauri signs the app
# WITHOUT --deep: it seals what it finds, so an extension has to arrive already
# signed with its own entitlements. (--deep would re-sign each .appex with the
# app's entitlements, dropping the sandbox that pluginkit requires — an
# extension without it is not registered at all.)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${1:?usage: build.sh <output-dir> [arch...]}"
shift || true
ARCHS=("$@")
[ "${#ARCHS[@]}" -gt 0 ] || ARCHS=("$(uname -m)")

# The Command Line Tools SDK carries only the legacy QuickLook generator API;
# QLPreviewProvider and QLThumbnailProvider ship with Xcode.
SDK="$(xcrun --sdk macosx --show-sdk-path)"
if [ ! -d "$SDK/System/Library/Frameworks/QuickLookUI.framework" ]; then
  echo "[quicklook] QuickLookUI is missing from $SDK" >&2
  echo "            Xcode is required: sudo xcode-select -s /Applications/Xcode.app" >&2
  exit 1
fi

# The extensions' version has to track the app's: pluginkit keys its registry on
# bundle id + version, so a stale version means an update is never picked up.
VERSION="$(/usr/bin/python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" \
  "$HERE/../../tauri.conf.json")"

# Build one .appex. Args: <source-dir> <bundle-name> <framework>...
build_extension() {
  local source_dir="$1" name="$2"; shift 2
  local frameworks=()
  for framework in "$@"; do frameworks+=(-framework "$framework"); done

  local appex="$OUT_DIR/$name.appex"
  rm -rf "$appex"
  mkdir -p "$appex/Contents/MacOS"
  cp "$HERE/$source_dir/Info.plist" "$appex/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$appex/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$appex/Contents/Info.plist"

  local slices=() arch slice
  for arch in "${ARCHS[@]}"; do
    slice="$(mktemp -d)/$name-$arch"
    xcrun --sdk macosx swiftc \
      -target "${arch}-apple-macos12.0" \
      -sdk "$SDK" \
      -module-name "$name" \
      -O -wmo \
      -application-extension \
      "${frameworks[@]}" \
      -Xlinker -e -Xlinker _NSExtensionMain \
      -o "$slice" \
      "$HERE"/Shared/*.swift "$HERE/$source_dir"/Sources/*.swift
    slices+=("$slice")
  done

  if [ "${#slices[@]}" -gt 1 ]; then
    lipo -create "${slices[@]}" -output "$appex/Contents/MacOS/$name"
  else
    cp "${slices[0]}" "$appex/Contents/MacOS/$name"
  fi

  if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
    codesign --force --timestamp --options runtime \
      --entitlements "$HERE/ComposeQuickLook.entitlements" \
      --sign "$APPLE_SIGNING_IDENTITY" "$appex"
    echo "[quicklook] built $name.appex ($(lipo -archs "$appex/Contents/MacOS/$name"), signed)"
  else
    echo "[quicklook] built $name.appex ($(lipo -archs "$appex/Contents/MacOS/$name"), unsigned — Quick Look will not load it)"
  fi
}

build_extension Preview ComposeQuickLook QuickLookUI
build_extension Thumbnail ComposeThumbnail QuickLookThumbnailing AppKit
