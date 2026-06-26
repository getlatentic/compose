#!/bin/bash
# Fetch + assemble Compose's bundled runtime — Node (LTS 22) + uv — into
# binaries/runtime/, for the arch selected by COMPOSE_RUNTIME_ARCH:
#   universal (default) → arm64 + x86_64 lipo'd (one .app runs on both)
#   arm64               → Apple Silicon only (a lean ~half-size build)
#   x86_64              → Intel only
# build-release.sh sets it per target. `tauri.conf.json` ships binaries/runtime/
# into the app's Resources; bundled_runtime.rs PATHs node/bin + bin at boot.
# Idempotent: skips work when the present binaries already match the requested
# arch (so switching arch between builds rebuilds only what changed).
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)" # src-tauri/
DEST="$HERE/binaries/runtime"
mkdir -p "$DEST"

RUNTIME_ARCH="${COMPOSE_RUNTIME_ARCH:-universal}"
case "$RUNTIME_ARCH" in
  universal) NODE_ARCHES="arm64 x64"; UV_TRIPLES="aarch64-apple-darwin x86_64-apple-darwin" ;;
  arm64)     NODE_ARCHES="arm64";     UV_TRIPLES="aarch64-apple-darwin" ;;
  x86_64)    NODE_ARCHES="x64";       UV_TRIPLES="x86_64-apple-darwin" ;;
  *) echo "[runtime] unknown COMPOSE_RUNTIME_ARCH='$RUNTIME_ARCH' (want universal|arm64|x86_64)" >&2; exit 1 ;;
esac

# True when a Mach-O already carries EXACTLY the arch(es) we want (bash-3.2 safe).
runtime_matches_arch() {
  local archs
  archs="$(lipo -archs "$1" 2>/dev/null || true)"
  case "$RUNTIME_ARCH" in
    universal) [[ "$archs" == *arm64* && "$archs" == *x86_64* ]] ;;
    arm64)     [[ "$archs" == "arm64" ]] ;;
    x86_64)    [[ "$archs" == "x86_64" ]] ;;
  esac
}

# Sign one bundled Mach-O. Tauri signs the app/frameworks/sidecars but never
# Resources, so these binaries must be signed here, before the bundler seals the
# .app. A release sets APPLE_SIGNING_IDENTITY (the same Developer ID Tauri uses):
# real signature + hardened runtime + secure timestamp, so the app notarizes.
# Without it (local dev), fall back to ad-hoc so macOS still runs the binary.
# $2 (optional) is an entitlements plist — node needs the JIT/library-validation
# exceptions; uv/uvx need none. codesign signs every slice of a universal binary.
sign_binary() {
  local bin="$1" entitlements="${2:-}"
  if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
    local args=(--force --timestamp --options runtime -s "$APPLE_SIGNING_IDENTITY")
    [ -n "$entitlements" ] && args+=(--entitlements "$entitlements")
    codesign "${args[@]}" "$bin"
  else
    codesign --force --sign - "$bin"
  fi
}

# --- Node (latest LTS 22) ---
# Re-fetch if node is missing, npm's cli got trimmed, OR the binary's arch no
# longer matches. The node DIRECTORY (lib/, npm) is arch-neutral JS — only
# bin/node is Mach-O — so the first arch's tarball provides the tree and (for
# universal) its node binary is lipo'd with the second arch's.
if [ ! -x "$DEST/node/bin/node" ] || [ ! -f "$DEST/node/lib/node_modules/npm/bin/npm-cli.js" ] || ! runtime_matches_arch "$DEST/node/bin/node"; then
  NODE_VERSION="$(curl -fsSL https://nodejs.org/dist/index.json |
    python3 -c "import json,sys;print(next(x['version'] for x in json.load(sys.stdin) if x['version'].startswith('v22.')))")"
  echo "[runtime] Node $NODE_VERSION ($RUNTIME_ARCH)…"
  work="$(mktemp -d)"
  for a in $NODE_ARCHES; do
    curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-$a.tar.gz" \
      -o "$work/node-$a.tar.gz"
    mkdir -p "$work/$a"
    tar -xzf "$work/node-$a.tar.gz" -C "$work/$a" --strip-components=1
  done
  rm -rf "$DEST/node"
  primary="${NODE_ARCHES%% *}" # first arch provides the (arch-neutral) tree
  mv "$work/$primary" "$DEST/node"
  if [ "$RUNTIME_ARCH" = universal ]; then
    lipo -create "$work/x64/bin/node" "$DEST/node/bin/node" -output "$work/node-universal"
    mv "$work/node-universal" "$DEST/node/bin/node"
    chmod +x "$DEST/node/bin/node"
  fi
  # Trim what a runtime never needs (keep bin/ + lib/node_modules/npm).
  rm -rf "$DEST/node/include" "$DEST/node/share/doc" "$DEST/node/share/man" "$DEST/node/share/systemtap"
  # Strip debug symbols (all slices) and drop corepack (yarn/pnpm shims we don't
  # use). Stripping breaks the Mach-O signature; the sign step below re-signs.
  strip "$DEST/node/bin/node" 2>/dev/null || true
  rm -rf "$DEST/node/lib/node_modules/corepack" "$DEST/node/bin/corepack"
  rm -rf "$work"
fi

# npm/npx ship as symlinks into lib/, and Tauri's resource bundler dereferences
# symlinks — which relocates npm-cli.js and breaks its relative require. Replace
# them with shell wrappers (regular files survive the copy, and are arch-neutral)
# that run the bundled node on the real cli.js. Run unconditionally so it also
# repairs an already-fetched node.
for tool in npm npx; do
  rm -f "$DEST/node/bin/$tool" # don't write THROUGH the symlink onto cli.js
  cat > "$DEST/node/bin/$tool" <<EOF
#!/bin/sh
here=\$(cd "\$(dirname "\$0")" && pwd)
exec "\$here/node" "\$here/../lib/node_modules/npm/bin/$tool-cli.js" "\$@"
EOF
  chmod +x "$DEST/node/bin/$tool"
done

# --- uv + uvx ---
if [ ! -x "$DEST/bin/uv" ] || ! runtime_matches_arch "$DEST/bin/uv"; then
  echo "[runtime] uv ($RUNTIME_ARCH)…"
  mkdir -p "$DEST/bin"
  work="$(mktemp -d)"
  for t in $UV_TRIPLES; do
    curl -fsSL "https://github.com/astral-sh/uv/releases/latest/download/uv-$t.tar.gz" \
      -o "$work/uv-$t.tar.gz"
    tar -xzf "$work/uv-$t.tar.gz" -C "$work" # extracts to uv-$t/
  done
  for tool in uv uvx; do
    if [ "$RUNTIME_ARCH" = universal ]; then
      lipo -create "$work/uv-aarch64-apple-darwin/$tool" "$work/uv-x86_64-apple-darwin/$tool" \
        -output "$DEST/bin/$tool"
    else
      primary_t="${UV_TRIPLES%% *}"
      cp "$work/uv-$primary_t/$tool" "$DEST/bin/$tool"
    fi
    chmod +x "$DEST/bin/$tool"
  done
  rm -rf "$work"
fi

# Sign the bundled Mach-O binaries (unconditional: a release re-signs an
# already-fetched, ad-hoc node/uv with the Developer ID). npm/npx are shell
# wrappers, not Mach-O — nothing to sign.
sign_binary "$DEST/node/bin/node" "$HERE/entitlements/runtime.plist"
sign_binary "$DEST/bin/uv"
sign_binary "$DEST/bin/uvx"

echo "[runtime] ready: node $("$DEST/node/bin/node" --version) [$(lipo -archs "$DEST/node/bin/node")], npm $("$DEST/node/bin/npm" --version), uv $("$DEST/bin/uv" --version) [$(lipo -archs "$DEST/bin/uv")]"
