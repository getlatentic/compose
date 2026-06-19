//! Runtime smoke-test: a live run with a trivial prompt that confirms a harness's
//! install + credential actually work end to end. Routed through the adapter, so
//! it works for any harness with no CLI knowledge duplicated host-side.

use harness::{Harness, RunEvent, RunHandle, RunMode, RunRequest, RunTuning};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

/// Outcome of a harness smoke-test, for the Settings "Test" button.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HarnessRuntimeVerification {
    pub installed: bool,
    /// The smoke run completed cleanly — the install + credential work.
    pub authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

const TIMEOUT: Duration = Duration::from_secs(45);
const PROMPT: &str = "Reply with exactly OK.";

/// Smoke-test a harness: probe readiness for install/version, then a trivial run
/// for authenticated/output. The caller exports the credential to the env first.
pub fn run(harness: &dyn Harness) -> HarnessRuntimeVerification {
    let readiness = harness.readiness();
    if !readiness.installed {
        return HarnessRuntimeVerification {
            installed: false,
            authenticated: false,
            version: readiness.version,
            output_preview: None,
            error_message: readiness
                .error
                .or_else(|| Some("This assistant is not installed yet.".to_owned())),
        };
    }

    let request = RunRequest {
        run_id: "compose-runtime-check".to_owned(),
        prompt: PROMPT.to_owned(),
        attachments: Vec::new(),
        cwd: scratch_dir(),
        mode: RunMode::Ask,
        tuning: RunTuning::default(),
        resume: None,
    };

    match harness.run_channel(request) {
        Ok((handle, events)) => drain(handle, events, readiness.version),
        Err(error) => HarnessRuntimeVerification {
            installed: true,
            authenticated: false,
            version: readiness.version,
            output_preview: None,
            error_message: Some(error.to_string()),
        },
    }
}

/// A scratch working directory for the smoke run, so the harness's tool calls
/// don't touch a real workspace. `None` if it can't be created — the run still
/// works (the adapter falls back to the process cwd).
fn scratch_dir() -> Option<PathBuf> {
    let dir = std::env::temp_dir().join("compose-runtime-check");
    std::fs::create_dir_all(&dir).ok().map(|_| dir)
}

/// Drain the smoke run to completion (or a timeout), collecting the assistant's
/// text and the terminal status. Success = exited cleanly with no error event.
fn drain(
    handle: RunHandle,
    events: Receiver<RunEvent>,
    version: Option<String>,
) -> HarnessRuntimeVerification {
    let deadline = Instant::now() + TIMEOUT;
    let mut output = String::new();
    let mut error_message: Option<String> = None;
    let mut exit_code: Option<i32> = None;
    let mut exited = false;

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            let _ = handle.cancel();
            error_message.get_or_insert_with(|| "Runtime check timed out.".to_owned());
            break;
        }
        match events.recv_timeout(remaining) {
            Ok(RunEvent::Text { delta, .. }) => output.push_str(&delta),
            Ok(RunEvent::Error { message, .. }) => {
                error_message.get_or_insert(message);
            }
            Ok(RunEvent::Exited {
                exit_code: code,
                cancelled,
                ..
            }) => {
                exit_code = code;
                exited = true;
                if cancelled {
                    error_message.get_or_insert_with(|| "Runtime check was cancelled.".to_owned());
                }
                break;
            }
            Ok(_) => {}
            Err(RecvTimeoutError::Timeout) => {
                let _ = handle.cancel();
                error_message.get_or_insert_with(|| "Runtime check timed out.".to_owned());
                break;
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    let authenticated = exited && exit_code == Some(0) && error_message.is_none();
    let error_message = if authenticated {
        None
    } else {
        error_message.or_else(|| {
            Some(match exit_code {
                Some(code) => format!("Runtime check exited with status {code}."),
                None => "Runtime check ended without completing.".to_owned(),
            })
        })
    };

    HarnessRuntimeVerification {
        installed: true,
        authenticated,
        version,
        output_preview: preview(&output),
        error_message,
    }
}

fn preview(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(500).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use harness::{
        CredentialSpec, HarnessError, HarnessInfo, HarnessReadiness, InstallCallback, RunCallback,
        RunControl,
    };

    struct NoopControl;
    impl RunControl for NoopControl {
        fn cancel(&self) -> Result<(), HarnessError> {
            Ok(())
        }
        fn was_cancelled(&self) -> bool {
            false
        }
    }

    /// A harness whose `run` replays a canned event sequence synchronously, so
    /// [`run`] can be exercised without a real subprocess. Only the methods it
    /// touches are implemented.
    struct MockHarness {
        installed: bool,
        version: Option<String>,
        events: Vec<RunEvent>,
    }

    impl Harness for MockHarness {
        fn info(&self) -> HarnessInfo {
            unreachable!("verify::run does not read info()")
        }
        fn readiness(&self) -> HarnessReadiness {
            HarnessReadiness {
                harness_id: "mock".to_owned(),
                ready: self.installed,
                installed: self.installed,
                version: self.version.clone(),
                auth_configured: true,
                error: None,
                details: serde_json::Value::Null,
            }
        }
        fn install(&self, _on_event: InstallCallback) -> Result<(), HarnessError> {
            Ok(())
        }
        fn run(
            &self,
            _request: RunRequest,
            on_event: RunCallback,
        ) -> Result<RunHandle, HarnessError> {
            for event in &self.events {
                on_event(event.clone());
            }
            Ok(Box::new(NoopControl))
        }
        fn credential(&self) -> CredentialSpec {
            unreachable!("verify::run does not read credential()")
        }
    }

    fn exited(code: i32) -> RunEvent {
        RunEvent::Exited {
            run_id: "compose-runtime-check".to_owned(),
            exit_code: Some(code),
            cancelled: false,
        }
    }

    fn text(delta: &str) -> RunEvent {
        RunEvent::Text {
            run_id: "compose-runtime-check".to_owned(),
            delta: delta.to_owned(),
        }
    }

    #[test]
    fn reports_not_installed_without_running() {
        let verification = run(&MockHarness {
            installed: false,
            version: None,
            events: vec![exited(0)],
        });
        assert!(!verification.installed);
        assert!(!verification.authenticated);
        assert!(verification.error_message.is_some());
    }

    #[test]
    fn passes_when_run_exits_zero_with_output() {
        let verification = run(&MockHarness {
            installed: true,
            version: Some("1.0.4".to_owned()),
            events: vec![text("OK"), exited(0)],
        });
        assert!(verification.installed);
        assert!(verification.authenticated);
        assert_eq!(verification.output_preview.as_deref(), Some("OK"));
        assert_eq!(verification.version.as_deref(), Some("1.0.4"));
        assert!(verification.error_message.is_none());
    }

    #[test]
    fn fails_when_run_exits_nonzero() {
        let verification = run(&MockHarness {
            installed: true,
            version: None,
            events: vec![exited(1)],
        });
        assert!(verification.installed);
        assert!(!verification.authenticated);
        assert!(verification
            .error_message
            .expect("nonzero exit must report an error")
            .contains("status 1"));
    }

    #[test]
    fn surfaces_an_error_event_over_the_exit_code() {
        let verification = run(&MockHarness {
            installed: true,
            version: None,
            events: vec![
                RunEvent::Error {
                    run_id: "compose-runtime-check".to_owned(),
                    message: "invalid API key".to_owned(),
                },
                exited(1),
            ],
        });
        assert!(!verification.authenticated);
        assert_eq!(verification.error_message.as_deref(), Some("invalid API key"));
    }
}
