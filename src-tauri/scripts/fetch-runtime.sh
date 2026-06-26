#!/bin/bash
# Fetch + assemble Compose's bundled runtime — Node (LTS 22) + uv — as UNIVERSAL
# (arm64 + x86_64) Mach-O binaries under binaries/runtime/, so the single .app
# runs on both Apple Silicon and Intel. `tauri.conf.json` ships binaries/runtime/
# into the app's Resources; bundled_runtime.rs puts node/bin + bin on PATH at
# boot. Idempotent: skips a binary already present AND already universal (an older
# single-arch fetch is rebuilt into a universal one). Run before a build.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)" # src-tauri/
DEST="$HERE/binaries/runtime"
mkdir -p "$DEST"

# True when a Mach-O already carries both arches we ship (kept bash-3.2 friendly
# for the system /bin/bash — no associative arrays / `lipo -archs` glob match).
is_universal() {
  local archs
  archs="$(lipo -archs "$1" 2>/dev/null || true)"
  [[ "$archs" == *arm64* && "$archs" == *x86_64* ]]
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

# --- Node (latest LTS 22), universal arm64 + x86_64 ---
# Re-fetch if node is missing, npm's cli got trimmed, OR the binary isn't yet
# universal. The node DIRECTORY (lib/, npm) is arch-independent JS — only bin/node
# is Mach-O — so we take the tree from the arm64 tarball and lipo its node binary
# together with the x64 tarball's.
if [ ! -x "$DEST/node/bin/node" ] || [ ! -f "$DEST/node/lib/node_modules/npm/bin/npm-cli.js" ] || ! is_universal "$DEST/node/bin/node"; then
  NODE_VERSION="$(curl -fsSL https://nodejs.org/dist/index.json |
    python3 -c "import json,sys;print(next(x['version'] for x in json.load(sys.stdin) if x['version'].startswith('v22.')))")"
  echo "[runtime] Node $NODE_VERSION (universal: arm64 + x86_64)…"
  work="$(mktemp -d)"
  for arch in arm64 x64; do
    curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-$arch.tar.gz" \
      -o "$work/node-$arch.tar.gz"
    mkdir -p "$work/$arch"
    tar -xzf "$work/node-$arch.tar.gz" -C "$work/$arch" --strip-components=1
  done
  rm -rf "$DEST/node"
  # The arm64 tree is the base; its bin/node becomes universal via lipo with x64.
  mv "$work/arm64" "$DEST/node"
  lipo -create "$work/x64/bin/node" "$DEST/node/bin/node" -output "$work/node-universal"
  mv "$work/node-universal" "$DEST/node/bin/node"
  chmod +x "$DEST/node/bin/node"
  # Trim what a runtime never needs (keep bin/ + lib/node_modules/npm).
  rm -rf "$DEST/node/include" "$DEST/node/share/doc" "$DEST/node/share/man" "$DEST/node/share/systemtap"
  # Strip both slices' debug symbols and drop corepack (yarn/pnpm shims we don't
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

# --- uv + uvx (universal arm64 + x86_64) ---
if [ ! -x "$DEST/bin/uv" ] || ! is_universal "$DEST/bin/uv"; then
  echo "[runtime] uv (universal: arm64 + x86_64)…"
  mkdir -p "$DEST/bin"
  work="$(mktemp -d)"
  for triple in aarch64-apple-darwin x86_64-apple-darwin; do
    curl -fsSL "https://github.com/astral-sh/uv/releases/latest/download/uv-$triple.tar.gz" \
      -o "$work/uv-$triple.tar.gz"
    tar -xzf "$work/uv-$triple.tar.gz" -C "$work" # extracts to uv-$triple/
  done
  for tool in uv uvx; do
    lipo -create "$work/uv-aarch64-apple-darwin/$tool" "$work/uv-x86_64-apple-darwin/$tool" \
      -output "$DEST/bin/$tool"
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
