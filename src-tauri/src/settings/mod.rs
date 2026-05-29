//! Tauri command surface for Bob settings + setup.
//!
//! Every command in this file is a thin adapter on top of
//! `bob-core` — the shared Rust library that also backs the
//! browser-preview dev API (`crates/bob-api`). The point of the
//! adapter layer is purely shape: the TypeScript front-end has
//! pre-existing wire types (`BobAuthStatus`, `BobInstallStatus`,
//! `BobRuntimeVerification`) that don't match `bob-core`'s
//! richer `BobReadinessSnapshot` 1:1, so we map between them
//! here rather than reshaping the TS surface.
//!
//! The runtime *smoke check* (`settings_verify_bob_runtime`) is
//! still implemented locally because it spawns bob with a real
//! prompt + measures the round-trip — that lives in `src-tauri`
//! alongside the bob runner code, not in `bob-core` whose
//! responsibility is install / readiness / keychain.

use crate::bob::locator::{resolve_bob_executable, BobExecutableError};
use crate::bob::{build_bob_command, BobApprovalMode, BobChatMode, BobCommandRequest, BobRunMode};
use bob_core::{
    auth_source, delete_api_key, get_readiness, install_bob, resolve_api_key, write_api_key,
    InstallEvent, KeySource,
};
use serde::Serialize;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

// --- Wire shapes (TS-facing) ---------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BobAuthStatus {
    pub configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

/// Mirrors `src/lib/ipc/settingsClient.ts::BobInstallStatus`.
/// Populated by adapting `bob_core::BobReadinessSnapshot` — same
/// underlying probe, different shape.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BobInstallStatus {
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_satisfies: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_min_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BobRuntimeVerification {
    pub installed: bool,
    pub authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

// --- Tauri commands ------------------------------------------------

/// Whether a Bob API key is configured (env or keychain).
/// Whether an API key is configured anywhere we look. Cheap and
/// **must stay cheap** — this runs at app boot. We deliberately
/// call `auth_source()` (env var + sidecar marker file lookup,
/// zero keychain touches) instead of `resolve_api_key()` so the
/// macOS Keychain password prompt does NOT fire before the user
/// has done anything. The value itself is fetched later by the
/// bob runner, when the user actually invokes Bob.
#[tauri::command(async)]
pub fn settings_get_bob_auth_status() -> Result<BobAuthStatus, String> {
    Ok(BobAuthStatus {
        configured: auth_source().is_some(),
        error_message: None,
    })
}

/// Used by `bob::runner::prepare_bob_spawn` to fetch the key
/// before spawning the bob CLI. Returns the actual key value —
/// never serialized to the front-end.
pub fn load_bob_api_key() -> Result<String, String> {
    match resolve_api_key() {
        Some((value, _)) => Ok(value),
        None => Err("Bob API key has not been configured".to_owned()),
    }
}

/// Save the key to the OS keychain. Source becomes `keychain`
/// regardless of what was there before — the env var, if set,
/// still takes precedence on read because `.env` is the dev
/// override.
#[tauri::command(async)]
pub fn settings_set_bob_api_key(api_key: String) -> Result<BobAuthStatus, String> {
    write_api_key(api_key.trim())?;
    Ok(BobAuthStatus { configured: true, error_message: None })
}

/// Adapt `bob_core::BobReadinessSnapshot` to the TS-facing
/// `BobInstallStatus` shape. Same fields, different layout.
#[tauri::command(async)]
pub fn settings_check_bob_install() -> Result<BobInstallStatus, String> {
    let snapshot = get_readiness();
    let error_message = if snapshot.bob.installed {
        None
    } else if !snapshot.node.installed {
        Some(format!("Node.js {}+ is required.", snapshot.node.min_version))
    } else if !snapshot.node.satisfies_min {
        Some(format!(
            "Node.js {}+ is required (found {})",
            snapshot.node.min_version,
            snapshot.node.version.as_deref().unwrap_or("unknown")
        ))
    } else {
        snapshot.bob.error.clone()
    };
    Ok(BobInstallStatus {
        installed: snapshot.bob.installed,
        path: snapshot.bob.path,
        version: snapshot.bob.version,
        error_message,
        node_version: snapshot.node.version,
        node_satisfies: Some(snapshot.node.satisfies_min),
        node_min_version: Some(snapshot.node.min_version),
    })
}

/// Stream the install via Tauri's `Channel`. Bridges
/// `bob_core::install_bob`'s blocking callback to the channel by
/// running the install on a worker thread and forwarding each
/// `InstallEvent` to the JS side.
///
/// The channel emits events with `#[serde(tag = "kind")]` so the
/// JS receiver matches them by `event.kind`. Same shape served
/// by the SSE endpoint in `bob-api` — JS doesn't branch on
/// transport.
#[tauri::command(async)]
pub fn settings_install_bob(on_event: Channel<InstallEvent>) -> Result<(), String> {
    // Move the channel into the callback closure. Each call to
    // the closure does a Channel::send; the closure is dropped
    // when bob_core::install_bob returns.
    let channel = on_event;
    install_bob(move |event| {
        let _ = channel.send(event);
    })
}

/// Smoke-test bob with a real prompt. Reuses the existing
/// dependency-injected helpers because the test suite below
/// covers the failure branches via mocks.
#[tauri::command(async)]
pub fn settings_verify_bob_runtime() -> Result<BobRuntimeVerification, String> {
    Ok(verify_bob_runtime_with_dependencies(
        resolve_bob_executable,
        run_bob_version_command,
        load_bob_api_key,
        run_bob_smoke_command,
    ))
}

// Suppress the unused-import warning when nothing in this module
// references `KeySource` directly. It's re-exported by bob-core
// and named here for grep-ability.
#[allow(dead_code)]
fn _key_source_anchor(_: KeySource) {}

// --- verify_bob_runtime helpers (kept local) -----------------------

fn run_bob_version_command(path: &Path) -> std::io::Result<std::process::Output> {
    Command::new(path).arg("--version").output()
}

fn verify_bob_runtime_with_dependencies<R, V, A, S>(
    resolver: R,
    version_runner: V,
    api_key_loader: A,
    smoke_runner: S,
) -> BobRuntimeVerification
where
    R: FnOnce() -> Result<crate::bob::locator::BobExecutable, BobExecutableError>,
    V: FnOnce(&Path) -> std::io::Result<Output>,
    A: FnOnce() -> Result<String, String>,
    S: FnOnce(&Path, &str) -> Result<Output, String>,
{
    let executable = match resolver() {
        Ok(executable) => executable,
        Err(error) => {
            return BobRuntimeVerification {
                authenticated: false,
                error_message: Some(error.to_string()),
                exit_code: None,
                installed: false,
                path: None,
                stderr_preview: None,
                stdout_preview: None,
                version: None,
            }
        }
    };
    let path = Some(executable.path.display().to_string());

    let version = match version_runner(&executable.path) {
        Ok(output) if output.status.success() => {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
        }
        Ok(output) => {
            return BobRuntimeVerification {
                authenticated: false,
                error_message: Some(format!(
                    "`{} --version` exited with status {}",
                    executable.path.display(),
                    output.status
                )),
                exit_code: output.status.code(),
                installed: false,
                path,
                stderr_preview: preview_bytes(&output.stderr),
                stdout_preview: preview_bytes(&output.stdout),
                version: None,
            }
        }
        Err(error) => {
            return BobRuntimeVerification {
                authenticated: false,
                error_message: Some(error.to_string()),
                exit_code: None,
                installed: false,
                path,
                stderr_preview: None,
                stdout_preview: None,
                version: None,
            }
        }
    };

    let api_key = match api_key_loader() {
        Ok(api_key) => api_key,
        Err(error) => {
            return BobRuntimeVerification {
                authenticated: false,
                error_message: Some(error),
                exit_code: None,
                installed: true,
                path,
                stderr_preview: None,
                stdout_preview: None,
                version,
            }
        }
    };

    match smoke_runner(&executable.path, &api_key) {
        Ok(output) => BobRuntimeVerification {
            authenticated: output.status.success(),
            error_message: if output.status.success() {
                None
            } else {
                Some(format!(
                    "Bob runtime check failed with exit status {}",
                    output.status
                ))
            },
            exit_code: output.status.code(),
            installed: true,
            path,
            stderr_preview: preview_bytes(&output.stderr),
            stdout_preview: preview_bytes(&output.stdout),
            version,
        },
        Err(error) => BobRuntimeVerification {
            authenticated: false,
            error_message: Some(error),
            exit_code: None,
            installed: true,
            path,
            stderr_preview: None,
            stdout_preview: None,
            version,
        },
    }
}

fn run_bob_smoke_command(path: &Path, api_key: &str) -> Result<Output, String> {
    let preview = build_bob_command(&BobCommandRequest {
        approval_mode: BobApprovalMode::Default,
        chat_mode: BobChatMode::Ask,
        context_file_paths: Vec::new(),
        max_coins: 32,
        mode: BobRunMode::JsonTask,
        prompt: Some("Reply with exactly OK.".to_owned()),
        workspace_id: None,
    })
    .map_err(|error| error.to_string())?;

    let smoke_dir = std::env::temp_dir().join("compose-runtime-check");
    std::fs::create_dir_all(&smoke_dir)
        .map_err(|error| format!("could not create Bob runtime check directory: {error}"))?;

    let mut child = Command::new(path)
        .args(preview.args)
        .current_dir(smoke_dir)
        .env("BOBSHELL_API_KEY", api_key)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("could not start Bob runtime check: {error}"))?;

    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().map_err(|error| error.to_string()),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Bob runtime check timed out after 45 seconds".to_owned());
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn preview_bytes(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes).trim().to_owned();
    if text.is_empty() {
        return None;
    }
    const MAX_PREVIEW_CHARS: usize = 500;
    let preview: String = text.chars().take(MAX_PREVIEW_CHARS).collect();
    Some(preview)
}

// Optional convenience: a private alias to make `delete_api_key`
// reachable as `settings::delete_api_key` should the front-end
// add a "Disconnect" command later. Unused today but kept so the
// re-export is discoverable via `grep`.
#[allow(dead_code)]
pub(crate) fn _delete_api_key() -> Result<(), String> {
    delete_api_key()
}

// --- Tests ---------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bob::locator::BobExecutable;

    fn fake_output(stdout: &str, success: bool) -> std::io::Result<std::process::Output> {
        use std::os::unix::process::ExitStatusExt;
        Ok(std::process::Output {
            status: std::process::ExitStatus::from_raw(if success { 0 } else { 1 << 8 }),
            stdout: stdout.as_bytes().to_vec(),
            stderr: Vec::new(),
        })
    }

    // Detection / install / keychain logic now lives in `bob-core`
    // and is covered by its own unit tests (see
    // `crates/bob-core/src/check.rs`). The tests below cover the
    // `verify_bob_runtime` smoke path only — that's the piece
    // still implemented locally.

    fn fake_smoke(stdout: &str, success: bool) -> Result<std::process::Output, String> {
        fake_output(stdout, success).map_err(|e| e.to_string())
    }

    #[test]
    fn verify_reports_unavailable_when_resolution_fails() {
        let verification = verify_bob_runtime_with_dependencies(
            || {
                Err(BobExecutableError::NotFound {
                    attempts: vec!["PATH".to_owned()],
                })
            },
            |_| fake_output("1.0.4\n", true),
            || Ok("test-key".to_owned()),
            |_, _| fake_smoke("OK", true),
        );
        assert!(!verification.installed);
        assert!(!verification.authenticated);
        assert!(verification.error_message.is_some());
    }

    #[test]
    fn verify_reports_unauthenticated_when_key_missing() {
        let verification = verify_bob_runtime_with_dependencies(
            || Ok(BobExecutable { path: "/tmp/bob".into() }),
            |_| fake_output("1.0.4\n", true),
            || Err("Bob API key has not been configured".to_owned()),
            |_, _| fake_smoke("OK", true),
        );
        assert!(verification.installed);
        assert!(!verification.authenticated);
        assert_eq!(
            verification.error_message.as_deref(),
            Some("Bob API key has not been configured")
        );
    }

    #[test]
    fn verify_passes_when_smoke_succeeds() {
        let verification = verify_bob_runtime_with_dependencies(
            || Ok(BobExecutable { path: "/tmp/bob".into() }),
            |_| fake_output("1.0.4\n", true),
            || Ok("test-key".to_owned()),
            |_, _| fake_smoke("OK", true),
        );
        assert!(verification.installed);
        assert!(verification.authenticated);
    }
}
