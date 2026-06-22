//! Streamed installer: runs a recipe's install strategy and reports progress
//! through the `InstallEvent` vocabulary. Exactly one `Done` is emitted per
//! install, whatever the path or failure. Modeled on bob-rs's `install_bob`.

use crate::system::elevate::{self, AdminOutcome};
use crate::system::recipe::{DependencyRecipe, InstallSpec};
use harness::{InstallCallback, InstallEvent};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::process::{Command, Stdio};
use std::thread;
use tempfile::NamedTempFile;

/// Checkpoint lines a script prints (`[STEP] …`) become `InstallEvent::Step`.
const STEP_PREFIX: &str = "[STEP] ";

const INSTALL_HOMEBREW: &str = include_str!("../../scripts/install-homebrew.sh");

/// Root-only prep for Homebrew: create and own the prefix so the unprivileged
/// installer needs no further sudo. A fixed constant — Apple Silicon gets a
/// clean `/opt/homebrew`; Intel gets only Homebrew's own subdirs of the shared
/// `/usr/local` (never a blanket chown of `/usr/local`).
const HOMEBREW_PREP: &str = r#"PFX=/opt/homebrew; [ "$(uname -m)" = arm64 ] || PFX=/usr/local; U="$(stat -f %Su /dev/console)"; if [ "$PFX" = /opt/homebrew ]; then mkdir -p "$PFX" && chown -R "$U":admin "$PFX"; else for d in bin etc include lib sbin share var opt Cellar Caskroom Frameworks Homebrew; do mkdir -p "/usr/local/$d" && chown "$U":admin "/usr/local/$d"; done; fi"#;

/// Run a recipe's install, streaming progress. Failures surface as a
/// `Done { ok: false }` rather than a return value — the caller is a
/// fire-and-stream Tauri command.
pub fn run_install(recipe: &DependencyRecipe, on_event: InstallCallback) {
    match &recipe.install {
        InstallSpec::BrewService(formula) => {
            stream_or_fail(&brew_install_script(formula, true), &on_event)
        }
        InstallSpec::XcodeSelect => install_xcode_clt(&on_event),
        InstallSpec::Homebrew => install_homebrew(&on_event),
    }
}

fn install_xcode_clt(on_event: &InstallCallback) {
    step(on_event, "Opening Apple's installer…");
    match Command::new("xcode-select").arg("--install").output() {
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            if stderr.contains("already installed") {
                step(on_event, "Command Line Tools are already installed.");
            } else {
                step(on_event, "Follow Apple's dialog to finish, then re-check below.");
            }
            done(on_event, Some(0), true);
        }
        Err(err) => {
            emit(on_event, InstallEvent::Stderr { text: err.to_string() });
            done(on_event, None, false);
        }
    }
}

fn install_homebrew(on_event: &InstallCallback) {
    step(on_event, "Asking for permission to set up developer tools…");
    let AdminOutcome {
        exit_code,
        stderr,
        user_cancelled,
    } = elevate::run_admin(
        HOMEBREW_PREP,
        "Compose wants to install developer tools (Homebrew).",
    );
    if user_cancelled {
        emit(
            on_event,
            InstallEvent::Stderr {
                text: "Permission was declined — no changes were made.".to_owned(),
            },
        );
        done(on_event, None, false);
        return;
    }
    if exit_code != Some(0) {
        let text = stderr.trim();
        if !text.is_empty() {
            emit(on_event, InstallEvent::Stderr { text: text.to_owned() });
        }
        done(on_event, exit_code, false);
        return;
    }
    step(on_event, "Permission granted. Installing Homebrew…");
    stream_or_fail(INSTALL_HOMEBREW, on_event);
}

/// `brew install <formula>` with the freshly-installed brew put on PATH — the
/// user's profile isn't updated until a new shell, so we `eval` shellenv here.
fn brew_install_script(formula: &str, start_service: bool) -> String {
    let service = if start_service {
        format!("echo \"[STEP] Starting {formula} in the background…\"\nbrew services start {formula}\n")
    } else {
        String::new()
    };
    format!(
        r#"set -e
PFX=/opt/homebrew
[ "$(uname -m)" = arm64 ] || PFX=/usr/local
eval "$("$PFX/bin/brew" shellenv)"
echo "[STEP] Installing {formula}…"
brew install {formula}
{service}echo "[STEP] {formula} is ready."
"#
    )
}

fn stream_or_fail(script: &str, on_event: &InstallCallback) {
    if let Err(err) = stream_bash(script, on_event.clone()) {
        emit(
            on_event,
            InstallEvent::Stderr {
                text: format!("Could not start the installer: {err}"),
            },
        );
        done(on_event, None, false);
    }
}

/// Spool `script` to a tempfile and run it under `bash -l` (login shell, so the
/// user's PATH is in scope), streaming stdout/stderr line-by-line and emitting a
/// terminal `Done`. Returns `Err` only if the child can't be started.
fn stream_bash(script: &str, on_event: InstallCallback) -> std::io::Result<()> {
    let mut tmp = NamedTempFile::new()?;
    tmp.write_all(script.as_bytes())?;
    let mut perms = tmp.as_file().metadata()?.permissions();
    perms.set_mode(0o755);
    tmp.as_file().set_permissions(perms)?;

    let mut child = Command::new("bash")
        .arg("-l")
        .arg(tmp.path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");

    let stdout_cb = on_event.clone();
    let stdout_handle = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let event = match line.strip_prefix(STEP_PREFIX) {
                Some(text) => InstallEvent::Step { text: text.to_owned() },
                None => InstallEvent::Stdout { text: line },
            };
            (*stdout_cb)(event);
        }
    });
    let stderr_cb = on_event.clone();
    let stderr_handle = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            (*stderr_cb)(InstallEvent::Stderr { text: line });
        }
    });

    let status = child.wait()?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();
    (*on_event)(InstallEvent::Done {
        exit_code: status.code(),
        ok: status.success(),
    });
    Ok(())
}

fn emit(on_event: &InstallCallback, event: InstallEvent) {
    (*on_event)(event);
}

fn step(on_event: &InstallCallback, text: &str) {
    emit(on_event, InstallEvent::Step { text: text.to_owned() });
}

fn done(on_event: &InstallCallback, exit_code: Option<i32>, ok: bool) {
    emit(on_event, InstallEvent::Done { exit_code, ok });
}
