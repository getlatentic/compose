#!/bin/bash
# Unprivileged Homebrew install. The privileged prefix prep already ran (via the
# native admin dialog in elevate.rs), so the official installer needs no further
# sudo here. Checkpoint lines are prefixed "[STEP] " for the UI.
set -e

echo "[STEP] Downloading and installing Homebrew (this can take a few minutes)…"
export NONINTERACTIVE=1
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

PFX=/opt/homebrew
[ "$(uname -m)" = arm64 ] || PFX=/usr/local
eval "$("$PFX/bin/brew" shellenv)"
echo "[STEP] Homebrew ready: $("$PFX/bin/brew" --version | head -n1)"
