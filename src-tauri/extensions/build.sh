#!/bin/bash
# Build Compose's app extensions — the .md Quick Look preview and thumbnail,
# Share → Compose, the actions Shortcuts, Spotlight and Siri offer, and the
# Recent Notes widget — and the entitlements the app needs to meet them in
# their shared folder.
#
# No Xcode project: an app extension is an executable whose entry point is
# Foundation's NSExtensionMain, plus an Info.plist naming the principal class.
# swiftc produces that directly, which keeps the extensions inside the build the
# rest of the app uses.
#
#   build.sh <output-dir> [arch...]      default arch: the host's
#
# COMPOSE_APP_ID names the app the extensions ship in (default: the shipped
# ai.latentic.compose). Extension ids and the app group follow it, so a test
# copy built under its own id never shares an inbox with an installed Compose.
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

SHIPPED_APP_ID=ai.latentic.compose
APP_ID="${COMPOSE_APP_ID:-$SHIPPED_APP_ID}"

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

# App Intents are described by metadata extracted from the compiler's record of
# their compile-time values, as Xcode does it: the compiler is told which
# protocols to record, and the processor reads that record beside the binary.
APP_INTENTS_PROTOCOLS='["AppIntent","EntityQuery","AppEntity","TransientEntity","AppEnum","AppShortcutProviding","AppShortcutsProvider","AnyResolverProviding","AppIntentsPackage","DynamicOptionsProvider","_IntentValueRepresentable","_AssistantIntentsProvider","_GenerativeFunctionExtractable","IntentValueQuery","Resolver"]'

# Build one .appex. Args: <name> <info-plist> <entitlements> <frameworks> <source-dir>...
# With APP_INTENTS set, its actions' metadata is extracted into Resources.
build_extension() {
  local name="$1" plist="$2" entitlements="$3" frameworks="$4"
  shift 4
  local appex="$OUT_DIR/$name.appex" sources=() flags=() dir framework
  for dir in "$@"; do sources+=("$dir"/*.swift); done
  for framework in $frameworks; do flags+=(-framework "$framework"); done
  # Compiled for the oldest macOS the extension says it runs on.
  local minimum
  minimum="$(/usr/libexec/PlistBuddy -c "Print :LSMinimumSystemVersion" "$plist")"
  local work
  work="$(mktemp -d)"
  if [ -n "${APP_INTENTS:-}" ]; then
    echo "$APP_INTENTS_PROTOCOLS" > "$work/protocols.json"
    flags+=(-parse-as-library -Xfrontend -const-gather-protocols-file -Xfrontend "$work/protocols.json")
  fi

  rm -rf "$appex"
  mkdir -p "$appex/Contents/MacOS"
  cp "$plist" "$appex/Contents/Info.plist"
  if [ -n "${RESOURCES:-}" ]; then
    mkdir -p "$appex/Contents/Resources"
    find "$RESOURCES" -maxdepth 1 -type f ! -name "*.test.ts" -exec cp {} "$appex/Contents/Resources/" \;
  fi
  local id
  id="$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$appex/Contents/Info.plist")"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $APP_ID${id#"$SHIPPED_APP_ID"}" "$appex/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$appex/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$appex/Contents/Info.plist"

  local slices=() arch slice
  for arch in "${ARCHS[@]}"; do
    slice="$work/$name-$arch"
    xcrun --sdk macosx swiftc \
      -target "${arch}-apple-macos${minimum}" \
      -sdk "$SDK" \
      -module-name "$name" \
      -O -wmo \
      -application-extension \
      ${flags[@]+"${flags[@]}"} \
      -emit-const-values-path "$slice.swiftconstvalues" \
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
  if [ -n "${APP_INTENTS:-}" ]; then
    extract_app_intents "$appex" "$name" "$minimum" "${slices[0]}.swiftconstvalues" "${sources[@]}"
  fi

  local state="unsigned — the system will not load it"
  if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
    codesign --force --timestamp --options runtime \
      --entitlements "$entitlements" --sign "$APPLE_SIGNING_IDENTITY" "$appex"
    state="signed"
  fi
  echo "[extensions] built $name.appex ($(lipo -archs "$appex/Contents/MacOS/$name"), $state)"
}

# Build a command-line helper that ships inside the app, signed with its own
# entitlements for the same reason as an extension.
# Args: <name> <identifier> <entitlements> <swift-file>...
build_helper() {
  local name="$1" identifier="$2" entitlements="$3"
  shift 3
  local helper="$OUT_DIR/$name" slices=() arch slice
  for arch in "${ARCHS[@]}"; do
    slice="$(mktemp -d)/$name-$arch"
    xcrun --sdk macosx swiftc \
      -target "${arch}-apple-macos12.0" \
      -sdk "$SDK" \
      -module-name "$name" \
      -O -wmo \
      -o "$slice" \
      "$@"
    slices+=("$slice")
  done
  if [ "${#slices[@]}" -gt 1 ]; then
    lipo -create "${slices[@]}" -output "$helper"
  else
    cp "${slices[0]}" "$helper"
  fi
  local state="unsigned — it cannot reach the app group"
  if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
    codesign --force --timestamp --options runtime --identifier "$identifier" \
      --entitlements "$entitlements" --sign "$APPLE_SIGNING_IDENTITY" "$helper"
    state="signed"
  fi
  echo "[extensions] built $name ($(lipo -archs "$helper"), $state)"
}

# Args: <appex> <module> <minimum-macos> <const-values> <source>...
# The processor succeeds and writes nothing when it finds no record, so the
# metadata is checked for: an extension without it offers no actions.
extract_app_intents() {
  local appex="$1" module="$2" minimum="$3" values="$4"
  shift 4
  local lists toolchain
  lists="$(mktemp -d)"
  printf '%s\n' "$@" > "$lists/sources"
  echo "$values" > "$lists/values"
  toolchain="$(cd "$(dirname "$(xcrun --find swiftc)")/../.." && pwd)"
  mkdir -p "$appex/Contents/Resources"
  xcrun appintentsmetadataprocessor \
    --toolchain-dir "$toolchain" \
    --module-name "$module" \
    --sdk-root "$SDK" \
    --xcode-version "$(xcodebuild -version | awk '/Build version/ {print $3}')" \
    --platform-family macOS \
    --deployment-target "$minimum" \
    --bundle-identifier "$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$appex/Contents/Info.plist")" \
    --output "$appex/Contents/Resources" \
    --target-triple "${ARCHS[0]}-apple-macos$minimum" \
    --binary-file "$appex/Contents/MacOS/$module" \
    --source-file-list "$lists/sources" \
    --swift-const-vals-list "$lists/values" \
    --compile-time-extraction \
    --deployment-aware-processing \
    --no-app-shortcuts-localization
  if [ ! -f "$appex/Contents/Resources/Metadata.appintents/extract.actionsdata" ]; then
    echo "[extensions] no App Intents metadata was extracted for $module" >&2
    exit 1
  fi
}

QUICKLOOK="$HERE/quicklook"
build_extension ComposeQuickLook "$QUICKLOOK/Preview/Info.plist" \
  "$QUICKLOOK/ComposeQuickLook.entitlements" "QuickLookUI" \
  "$QUICKLOOK/Shared" "$QUICKLOOK/Preview/Sources"
build_extension ComposeThumbnail "$QUICKLOOK/Thumbnail/Info.plist" \
  "$QUICKLOOK/ComposeQuickLook.entitlements" "QuickLookThumbnailing AppKit" \
  "$QUICKLOOK/Shared" "$QUICKLOOK/Thumbnail/Sources"

# Share, the actions and the widget all run sandboxed in the group.
GROUP_EXTENSION_ENTITLEMENTS="$OUT_DIR/GroupExtension.entitlements"
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  : "${APPLE_TEAM_ID:?APPLE_TEAM_ID names the app group, so signing needs it}"
  APP_GROUP="$APPLE_TEAM_ID.$APP_ID"
  write_group_entitlements "$GROUP_EXTENSION_ENTITLEMENTS" sandboxed "$APP_GROUP"
  write_group_entitlements "$OUT_DIR/Compose.entitlements" unsandboxed "$APP_GROUP"
  write_group_entitlements "$OUT_DIR/ComposeClipper.entitlements" unsandboxed "$APP_GROUP"
fi
# Share hands over the files Compose opens, and macOS lets it only for the types
# Compose declares — so the list the sheet checks comes from tauri.conf.json.
DOCUMENT_EXTENSIONS=()
while IFS= read -r extension; do
  DOCUMENT_EXTENSIONS+=("$extension")
done < <(/usr/bin/python3 -c "
import json, sys
for association in json.load(open(sys.argv[1]))['bundle']['fileAssociations']:
    print('\\n'.join(association['ext']))
" "$HERE/../tauri.conf.json")
SHARE_PLIST="$(mktemp -d)/Info.plist"
cp "$HERE/share/Info.plist" "$SHARE_PLIST"
plutil -replace ComposeDocumentExtensions -json \
  "$(/usr/bin/python3 -c 'import json, sys; print(json.dumps(sys.argv[1:]))' "${DOCUMENT_EXTENSIONS[@]}")" \
  "$SHARE_PLIST"
RESOURCES="$HERE/share/Resources" build_extension ComposeShare "$SHARE_PLIST" "$GROUP_EXTENSION_ENTITLEMENTS" \
  "AppKit SwiftUI" "$HERE/shared" "$HERE/share/Sources"
# The browser clipper's native-messaging host: a browser starts it to hand over
# a clip, which it leaves in the share inbox using the shared contract and inbox.
build_helper ComposeClipper "$APP_ID.clipper" "$OUT_DIR/ComposeClipper.entitlements" \
  "$HERE/shared/Contract.swift" \
  "$HERE/shared/ShareInbox.swift" \
  "$HERE/shared/ClipDraft.swift" \
  "$HERE"/clipper/Sources/*.swift

APP_INTENTS=1 build_extension ComposeIntents "$HERE/intents/Info.plist" "$GROUP_EXTENSION_ENTITLEMENTS" \
  "AppKit AppIntents" "$HERE/shared" "$HERE/entities" "$HERE/intents/Sources" "$HERE/intents/Main"

# Its configuration is an App Intent, so it carries App Intents metadata too.
APP_INTENTS=1 build_extension ComposeWidget "$HERE/widget/Info.plist" "$GROUP_EXTENSION_ENTITLEMENTS" \
  "AppKit AppIntents SwiftUI WidgetKit" "$HERE/shared" "$HERE/entities" "$HERE/widget/Sources" "$HERE/widget/Main"
