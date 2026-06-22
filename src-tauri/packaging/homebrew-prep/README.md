# Homebrew-prep installer package

The one place Compose needs root is creating Homebrew's prefix (`/opt/homebrew`
on Apple Silicon). This package does that root step through Apple's **Installer**
instead of `osascript … with administrator privileges`, so there is no
scripting-engine-spawns-root-shell behavior for AV/EDR to flag. It is the
trusted, one-shot alternative — no privileged-helper daemon.

## What it does

`scripts/postinstall` runs **as root** (Installer authenticates the user once)
and creates + `chown`s the Homebrew prefix to the console user, so the
*unprivileged* Homebrew installer that runs afterward
(`src-tauri/scripts/install-homebrew.sh`) needs no further sudo. Idempotent.

## Build

```sh
./build.sh                                                   # unsigned — local testing only
DEVELOPER_ID_INSTALLER="Developer ID Installer: NAME (TEAMID)" ./build.sh    # signed
DEVELOPER_ID_INSTALLER="…" NOTARY_PROFILE=my-profile ./build.sh             # signed + notarized
```

Set the notary profile up once:

```sh
xcrun notarytool store-credentials my-profile \
  --apple-id <apple-id> --team-id <team-id> --password <app-specific-password>
```

Output: `build/homebrew-prep.pkg` (gitignored). Only the **signed + notarized**
output is shippable; an unsigned pkg is Gatekeeper-blocked on other machines.

## Wiring into the app (pending Developer ID + a buildable tree)

1. Run `build.sh` before `tauri build` (add to `beforeBuildCommand`) and ship the
   result via `tauri.conf.json` → `bundle.resources`, so the `.pkg` is inside the
   `.app`.
2. In `src-tauri/src/system/install.rs`, `install_homebrew` swaps the
   `elevate::run_admin(HOMEBREW_PREP, …)` call for resolving the bundled pkg and
   `open`-ing it (Installer.app). Completion is asynchronous — re-probe
   `brew --version`, like the Command-Line-Tools recipe.
3. The unprivileged `install-homebrew.sh` step is unchanged.

Until the cert is set up, `install_homebrew` keeps the osascript-admin prep as
the interim path, and that path stays the optional / "Advanced" one — the default
flow (Ollama, Node, uv, Claude, Codex, bob) needs no root at all.
