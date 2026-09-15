#!/bin/bash
# Build Compose's app extensions — the .md Quick Look preview and thumbnail, and
# Share → Compose — and the entitlements the app needs to receive shared clips.
#
# No Xcode project: an app extension is an executable whose entry point is
# Foundation's NSExtensionMain, plus an Info.plist naming the principal class.
# swiftc produces that directly, which keeps the extensions inside the build the
# rest of the app uses.
#
#   build.sh <output-dir> [arch...]      default arch: the host's
#
# Signed here when APPLE_SIGNING_IDENTITY is set, because Tauri signs the app
# WITHOUT --deep: it seals what it finds, so each extension has to arrive
# already signed with its own entitlements. (--deep would re-sign an .appex with
# the app's entitlements, dropping the sandbox that pluginkit requires — an
# extension without it is not registered at all.)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${1:?usage: build.sh <output-dir> [arch...]}"
shift || true
ARCHS=("$@")
[ "${#ARCHS[@]}" -gt 0 ] || ARCHS=("$(uname -m)")
mkdir -p "$OUT_DIR"

# The Command Line Tools SDK carries only the legacy QuickLook generator API;
# QLPreviewProvider and QLThumbnailProvider ship with Xcode.
SDK="$(xcrun --sdk macosx --show-sdk-path)"
if [ ! -d "$SDK/System/Library/Frameworks/QuickLookUI.framework" ]; then
  echo "[extensions] QuickLookUI is missing from $SDK" >&2
  echo "             Xcode is required: sudo xcode-select -s /Applications/Xcode.app" >&2
  exit 1
fi

# An extension's version has to track the app's: pluginkit keys its registry on
# bundle id + version, so a stale version means an update is never picked up.
VERSION="$(/usr/bin/python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" \
  "$HERE/../tauri.conf.json")"

# The share sheet and the app meet in an app-group container. On macOS a group
# is named for the team that signs it, which only the signing identity knows —
# so the entitlements naming it are written here rather than committed.
# Args: <path> <sandboxed|unsandboxed> <group>
write_group_entitlements() {
  local path="$1" sandbox="$2" group="$3"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    [ "$sandbox" = sandboxed ] && echo '<key>com.apple.security.app-sandbox</key><true/>'
    echo "<key>com.apple.security.application-groups</key><array><string>$group</string></array>"
    echo '</dict></plist>'
  } > "$path"
}

# Build one .appex. Args: <name> <info-plist> <entitlements> <frameworks> <source-dir>...
build_extension() {
  local name="$1" plist="$2" entitlements="$3" frameworks="$4"
  shift 4
  local appex="$OUT_DIR/$name.appex" sources=() flags=() dir framework
  for dir in "$@"; do sources+=("$dir"/*.swift); done
  for framework in $frameworks; do flags+=(-framework "$framework"); done

  rm -rf "$appex"
  mkdir -p "$appex/Contents/MacOS"
  cp "$plist" "$appex/Contents/Info.plist"
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
      ${flags[@]+"${flags[@]}"} \
      -Xlinker -e -Xlinker _NSExtensionMain \
      -o "$slice" \
      "${sources[@]}"
    slices+=("$slice")
  done
  if [ "${#slices[@]}" -gt 1 ]; then
    lipo -create "${slices[@]}" -output "$appex/Contents/MacOS/$name"
  else
    cp "${slices[0]}" "$appex/Contents/MacOS/$name"
  fi

  local state="unsigned — the system will not load it"
  if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
    codesign --force --timestamp --options runtime \
      --entitlements "$entitlements" --sign "$APPLE_SIGNING_IDENTITY" "$appex"
    state="signed"
  fi
  echo "[extensions] built $name.appex ($(lipo -archs "$appex/Contents/MacOS/$name"), $state)"
}

QUICKLOOK="$HERE/quicklook"
build_extension ComposeQuickLook "$QUICKLOOK/Preview/Info.plist" \
  "$QUICKLOOK/ComposeQuickLook.entitlements" "QuickLookUI" \
  "$QUICKLOOK/Shared" "$QUICKLOOK/Preview/Sources"
build_extension ComposeThumbnail "$QUICKLOOK/Thumbnail/Info.plist" \
  "$QUICKLOOK/ComposeQuickLook.entitlements" "QuickLookThumbnailing AppKit" \
  "$QUICKLOOK/Shared" "$QUICKLOOK/Thumbnail/Sources"

SHARE_ENTITLEMENTS="$OUT_DIR/ComposeShare.entitlements"
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  : "${APPLE_TEAM_ID:?APPLE_TEAM_ID names the app group, so signing needs it}"
  APP_GROUP="$APPLE_TEAM_ID.ai.latentic.compose"
  write_group_entitlements "$SHARE_ENTITLEMENTS" sandboxed "$APP_GROUP"
  write_group_entitlements "$OUT_DIR/Compose.entitlements" unsandboxed "$APP_GROUP"
fi
build_extension ComposeShare "$HERE/share/Info.plist" "$SHARE_ENTITLEMENTS" "AppKit SwiftUI" \
  "$HERE/share/Sources"
