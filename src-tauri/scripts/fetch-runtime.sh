#!/bin/bash
# Fetch the runtime Compose bundles into its .app — Node (LTS 22) + uv — for
# macOS arm64, into binaries/runtime/. Idempotent: skips a binary that's already
# present. `tauri.conf.json` ships binaries/runtime/ into the app's Resources;
# bundled_runtime.rs puts node/bin + bin on PATH at boot. Run before a build.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)" # src-tauri/
DEST="$HERE/binaries/runtime"
ARCH="arm64"
mkdir -p "$DEST"

# Sign one bundled Mach-O. Tauri signs the app/frameworks/sidecars but never
# Resources, so these binaries must be signed here, before the bundler seals the
# .app. A release sets APPLE_SIGNING_IDENTITY (the same Developer ID Tauri uses):
# real signature + hardened runtime + secure timestamp, so the app notarizes.
# Without it (local dev), fall back to ad-hoc so macOS still runs the binary.
# $2 (optional) is an entitlements plist — node needs the JIT/library-validation
# exceptions; uv/uvx need none.
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

# --- Node (latest LTS 22, darwin-arm64) ---
if [ ! -x "$DEST/node/bin/node" ]; then
  NODE_VERSION="$(curl -fsSL https://nodejs.org/dist/index.json |
    python3 -c "import json,sys;print(next(x['version'] for x in json.load(sys.stdin) if x['version'].startswith('v22.')))")"
  echo "[runtime] Node $NODE_VERSION ($ARCH)…"
  TARBALL="node-$NODE_VERSION-darwin-$ARCH"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$TARBALL.tar.gz" -o /tmp/compose-node.tar.gz
  rm -rf "$DEST/node"
  mkdir -p "$DEST/node"
  tar -xzf /tmp/compose-node.tar.gz -C "$DEST/node" --strip-components=1
  # Trim what a runtime never needs (keep bin/ + lib/node_modules/npm).
  rm -rf "$DEST/node/include" "$DEST/node/share/doc" "$DEST/node/share/man" "$DEST/node/share/systemtap"
  # Shrink: strip ~22 MB of debug symbols off the node binary, and drop corepack
  # (the yarn/pnpm shims we don't use — we install via npm). Stripping breaks the
  # Mach-O signature; the unconditional sign step at the end re-signs it.
  strip "$DEST/node/bin/node" 2>/dev/null || true
  rm -rf "$DEST/node/lib/node_modules/corepack" "$DEST/node/bin/corepack"
  rm -f /tmp/compose-node.tar.gz
fi

# npm/npx ship as symlinks into lib/, and Tauri's resource bundler dereferences
# symlinks — which relocates npm-cli.js and breaks its relative require. Replace
# them with shell wrappers (regular files survive the copy) that run the bundled
# node on the real cli.js, so npm works from inside the read-only .app. Run
# unconditionally so it also repairs an already-fetched node.
for tool in npm npx; do
  rm -f "$DEST/node/bin/$tool" # don't write THROUGH the symlink onto cli.js
  cat > "$DEST/node/bin/$tool" <<EOF
#!/bin/sh
here=\$(cd "\$(dirname "\$0")" && pwd)
exec "\$here/node" "\$here/../lib/node_modules/npm/bin/$tool-cli.js" "\$@"
EOF
  chmod +x "$DEST/node/bin/$tool"
done

# --- uv (darwin-arm64) ---
if [ ! -x "$DEST/bin/uv" ]; then
  echo "[runtime] uv ($ARCH)…"
  mkdir -p "$DEST/bin"
  curl -fsSL "https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-apple-darwin.tar.gz" -o /tmp/compose-uv.tar.gz
  tar -xzf /tmp/compose-uv.tar.gz -C /tmp
  cp /tmp/uv-aarch64-apple-darwin/uv "$DEST/bin/uv"
  cp /tmp/uv-aarch64-apple-darwin/uvx "$DEST/bin/uvx"
  chmod +x "$DEST/bin/uv" "$DEST/bin/uvx"
  rm -rf /tmp/compose-uv.tar.gz /tmp/uv-aarch64-apple-darwin
fi

# Sign the bundled Mach-O binaries (unconditional: a release re-signs an
# already-fetched, ad-hoc node/uv with the Developer ID). npm/npx are shell
# wrappers, not Mach-O — nothing to sign.
sign_binary "$DEST/node/bin/node" "$HERE/entitlements/runtime.plist"
sign_binary "$DEST/bin/uv"
sign_binary "$DEST/bin/uvx"

echo "[runtime] ready: node $("$DEST/node/bin/node" --version), npm $("$DEST/node/bin/npm" --version), uv $("$DEST/bin/uv" --version)"
