#!/usr/bin/env bash
# Bootstrap a local self-signed code-signing cert for Tauri dev
# builds. Runs once per machine. After this, every `pnpm tauri
# build` produces a binary with a stable code-signing identity
# — so macOS Keychain "Always Allow" decisions stick across
# rebuilds, and our keychain access prompt only fires the first
# time the user runs ANY signed-with-this-identity build.
#
# This is NOT a substitute for Apple Developer ID + notarization
# when shipping to other people. It's only for local development
# iteration: macOS will still show "unidentified developer"
# warnings if someone else tries to run the .app. For
# distribution, see https://tauri.app/v2/distribute/sign-macos/
#
# Usage:
#   bash scripts/setup-dev-signing.sh
#
# Idempotent: rerunning when the cert is already in your keychain
# is a no-op.

set -euo pipefail

CERT_NAME="${CERT_NAME:-Compose Dev}"
KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"

# -----------------------------------------------------------------
# 1. Bail early if the cert already exists.
# -----------------------------------------------------------------
if security find-certificate -c "$CERT_NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "✓ Cert '$CERT_NAME' already exists in your login keychain."
  echo "  No action needed. Tauri will pick it up automatically"
  echo "  if APPLE_SIGNING_IDENTITY is set or"
  echo "  tauri.conf.json::bundle.macOS.signingIdentity matches."
  exit 0
fi

# -----------------------------------------------------------------
# 2. Generate a fresh self-signed code-signing cert via openssl.
#    macOS's `security` CLI can import .p12 bundles but isn't
#    great at *creating* code-signing certs directly — openssl
#    is the more reliable path.
# -----------------------------------------------------------------
echo "→ Generating self-signed code-signing cert '$CERT_NAME'..."

TMPDIR_LOCAL="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_LOCAL"' EXIT
cd "$TMPDIR_LOCAL"

# Private RSA-2048 key for the cert.
openssl genrsa -out key.pem 2048 2>/dev/null

# OpenSSL extension config requesting the codeSigning EKU. macOS
# requires this exact OID (1.3.6.1.5.5.7.3.3) on certs that
# Gatekeeper / Keychain ACL will accept for code-signing
# purposes. Without it the codesign tool fails with
# "no identity found".
cat > csr.cnf <<EOF
[req]
distinguished_name = name
prompt = no

[name]
CN = $CERT_NAME

[v3_codesign]
extendedKeyUsage = critical, codeSigning
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
EOF

# 10-year validity so it doesn't quietly expire mid-dev.
openssl req -new -x509 \
  -key key.pem \
  -out cert.pem \
  -days 3650 \
  -extensions v3_codesign \
  -config csr.cnf \
  -subj "/CN=$CERT_NAME" \
  2>/dev/null

# Bundle into a passwordless PKCS#12 file so `security import`
# can ingest both the cert AND its private key.
openssl pkcs12 -export \
  -in cert.pem \
  -inkey key.pem \
  -out cert.p12 \
  -passout pass: \
  2>/dev/null

# -----------------------------------------------------------------
# 3. Import into the login keychain. `-T` whitelists the
#    `codesign` binary so it can use the private key without
#    prompting the user every build.
# -----------------------------------------------------------------
security import cert.p12 \
  -k "$KEYCHAIN" \
  -P "" \
  -T /usr/bin/codesign \
  -T /usr/bin/security \
  >/dev/null

# `security import` whitelists the apps but doesn't unconditionally
# update the partition list — without this extra step macOS will
# still prompt for the keychain password the first time codesign
# wants to use the private key. The `-S` flag rewrites the ACL.
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "" \
  "$KEYCHAIN" \
  >/dev/null 2>&1 || true

# -----------------------------------------------------------------
# 4. Trust the cert for code-signing in the login keychain.
#    Without this, codesign will see the cert but refuse to use
#    it ("CSSMERR_TP_NOT_TRUSTED").
# -----------------------------------------------------------------
# `add-trusted-cert` requires admin auth. We do it with `-r
# unspecified` so it's trusted for its declared purposes (which
# includes codeSigning per the EKU we set above) without
# escalating to "trusted for everything".
security add-trusted-cert \
  -d \
  -r unspecified \
  -k "$KEYCHAIN" \
  cert.pem \
  >/dev/null 2>&1 || true

echo
echo "✓ Cert '$CERT_NAME' installed in your login keychain."
echo
echo "Next steps:"
echo "  1. Export the identity name to your shell:"
echo "       export APPLE_SIGNING_IDENTITY=\"$CERT_NAME\""
echo "     (Add to ~/.zshrc or ~/.bashrc to persist.)"
echo
echo "  2. Rebuild:"
echo "       pnpm tauri build"
echo
echo "  3. The first time you run the new .app, macOS will still"
echo "     prompt for keychain access — click 'Always Allow'."
echo "     From that moment on, every rebuild trusts the same"
echo "     identity, so no more re-prompts."
