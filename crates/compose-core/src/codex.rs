//! OpenAI Codex (`codex`) as a [`Harness`].
//!
//! Same process-spawn shape as the bob and Claude adapters — a
//! different binary, flags, and stdout parser. We invoke
//! `codex exec --json` and parse its JSONL into the shared
//! normalized [`RunEvent`] stream.
//!
//! Auth: like Claude Code, Codex manages its own credentials (its
//! `codex login` / ChatGPT auth or its own `OPENAI_API_KEY` in the
//! environment), so Compose does not store or inject a key —
//! `credential().required` is `false`.
//!
//! Wire format reference (verified against the official docs,
//! https://developers.openai.com/codex/noninteractive): `--json`
//! emits one JSON object per line. The assistant's reply is an
//! `item.completed` event whose `item.type == "agent_message"` with
//! the full text in `item.text` — Codex sends the whole message at
//! once, not token deltas. Command executions arrive as
//! `command_execution` items; `thread.started` / `turn.*` are
//! lifecycle and ignored (process start/exit drives Started/Exited).

use std::path::PathBuf;
use std::process::Command;

use bob_core::{spawn_streaming, InstallEvent};
use serde_json::Value;

use crate::events::{normalize_process_event, ParsedLine};
use crate::{
    CredentialSpec, Harness, HarnessCapabilities, HarnessInfo, HarnessReadiness, InstallCallback,
    RunCallback, RunHandle, RunMode, RunRequest, RunTuning,
};

/// Registry id for the Codex harness.
pub const CODEX_HARNESS_ID: &str = "codex";

/// OpenAI Codex CLI as a [`Harness`].
#[derive(Debug, Default, Clone)]
pub struct CodexHarness;

impl CodexHarness {
    pub fn new() -> Self {
        Self
    }
}

impl Harness for CodexHarness {
    fn info(&self) -> HarnessInfo {
        HarnessInfo {
            id: CODEX_HARNESS_ID.to_owned(),
            display_name: "Codex".to_owned(),
            description: "OpenAI's Codex agent CLI. Uses your existing Codex login.".to_owned(),
            requires_install: true,
            capabilities: HarnessCapabilities {
                // Codex owns its own login and edits files directly.
                // Model names change often, so allow free-text entry
                // rather than a curated list; it exposes reasoning
                // effort but no turn cap.
                credential_required: false,
                previews_edits: false,
                models: Vec::new(),
                allows_custom_model: true,
                supports_effort: true,
                supports_max_turns: false,
            },
        }
    }

    fn readiness(&self) -> HarnessReadiness {
        match probe_version("codex") {
            Some(version) => HarnessReadiness {
                harness_id: CODEX_HARNESS_ID.to_owned(),
                ready: true,
                installed: true,
                version: Some(version),
                auth_configured: true,
                error: None,
                details: Value::Null,
            },
            None => HarnessReadiness {
                harness_id: CODEX_HARNESS_ID.to_owned(),
                ready: false,
                installed: false,
                version: None,
                auth_configured: false,
                error: Some("Codex (`codex`) is not installed or not on PATH.".to_owned()),
                details: Value::Null,
            },
        }
    }

    fn install(&self, on_event: InstallCallback) -> Result<(), String> {
        (*on_event)(InstallEvent::Step {
            text: "Installing Codex via npm…".to_owned(),
        });
        let output = Command::new("npm")
            .args(["install", "-g", "@openai/codex"])
            .env("PATH", bob_core::augmented_node_path())
            .output()
            .map_err(|e| format!("failed to run npm: {e}"))?;
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            (*on_event)(InstallEvent::Stdout {
                text: line.to_owned(),
            });
        }
        for line in String::from_utf8_lossy(&output.stderr).lines() {
            (*on_event)(InstallEvent::Stderr {
                text: line.to_owned(),
            });
        }
        (*on_event)(InstallEvent::Done {
            exit_code: output.status.code(),
            ok: output.status.success(),
        });
        Ok(())
    }

    fn run(&self, request: RunRequest, on_event: RunCallback) -> Result<RunHandle, String> {
        let RunRequest { run_id, prompt, cwd, mode, tuning } = request;
        let args = build_codex_args(prompt, mode, &tuning);
        let cwd = cwd.unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

        // No env injected — Codex uses its own auth. PATH augmentation
        // in spawn_streaming ensures `node` is found for a
        // Finder-launched .app.
        let handle = spawn_streaming(
            PathBuf::from("codex"),
            args,
            Vec::new(),
            cwd,
            run_id,
            move |event| {
                for normalized in normalize_process_event(event, parse_codex_line) {
                    (*on_event)(normalized);
                }
            },
        )?;
        Ok(Box::new(handle))
    }

    fn credential(&self) -> CredentialSpec {
        CredentialSpec {
            label: "Codex login (managed by the codex CLI)".to_owned(),
            keychain_service: "openai".to_owned(),
            keychain_account: "OPENAI_API_KEY".to_owned(),
            required: false,
        }
    }
}

fn probe_version(program: &str) -> Option<String> {
    // Augment PATH so a packaged `.app` (minimal launchd PATH) can find a
    // CLI installed via nvm / Homebrew / official installer — otherwise an
    // installed CLI is mis-reported as "not installed".
    let output = Command::new(program)
        .arg("--version")
        .env("PATH", bob_core::augmented_node_path())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Build the argv for a `codex exec --json` headless run. Kept pure
/// (no spawn) so the flag mapping is unit-tested. `tuning.model` →
/// `--model`; `tuning.effort` → `-c model_reasoning_effort="..."`
/// (codex's config override, value parsed as TOML); Codex has no
/// turn-cap flag, so `tuning.max_turns` is intentionally ignored.
/// Options precede the positional prompt, as `codex exec` expects.
fn build_codex_args(prompt: String, mode: RunMode, tuning: &RunTuning) -> Vec<String> {
    let mut args = vec!["exec".to_owned(), "--json".to_owned()];
    if let Some(model) = tuning.model.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        args.push("--model".to_owned());
        args.push(model.to_owned());
    }
    if let Some(effort) = tuning.effort {
        args.push("-c".to_owned());
        args.push(format!("model_reasoning_effort=\"{}\"", effort.as_cli_value()));
    }
    if matches!(mode, RunMode::Edit) {
        // Low-friction sandboxed auto-execution so Codex can apply
        // edits without interactive approval. (Exact sandbox flags
        // vary by codex version; --full-auto is the stable one.)
        args.push("--full-auto".to_owned());
    }
    args.push(prompt);
    args
}

/// Parse one line of `codex exec --json` JSONL into the shared
/// [`ParsedLine`]. Assistant text is the full `agent_message` on
/// `item.completed`; command executions become activity. Codex edits
/// files directly via tools (reflected on disk by the file watcher),
/// so it never emits suggested-edit previews — `edits` stays empty.
pub fn parse_codex_line(line: &str) -> ParsedLine {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return ParsedLine::default();
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return ParsedLine::default();
    };
    let Some(obj) = value.as_object() else {
        return ParsedLine::default();
    };

    match obj.get("type").and_then(Value::as_str) {
        Some("item.completed") => {
            let Some(item) = obj.get("item").and_then(Value::as_object) else {
                return ParsedLine::default();
            };
            // The assistant's reply: full text in one shot.
            if item.get("type").and_then(Value::as_str) == Some("agent_message") {
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    if !text.is_empty() {
                        return ParsedLine {
                            text: Some(text.to_owned()),
                            ..ParsedLine::default()
                        };
                    }
                }
            }
            ParsedLine::default()
        }
        Some("item.started") => {
            let Some(item) = obj.get("item").and_then(Value::as_object) else {
                return ParsedLine::default();
            };
            match item.get("type").and_then(Value::as_str) {
                Some("command_execution") => {
                    let command = item.get("command").and_then(Value::as_str).unwrap_or("");
                    let activity = if command.is_empty() {
                        "Running a command".to_owned()
                    } else {
                        format!("Running: {}", truncate(command, 80))
                    };
                    ParsedLine {
                        activity: Some(activity),
                        ..ParsedLine::default()
                    }
                }
                Some("file_change") => ParsedLine {
                    activity: Some("Editing files".to_owned()),
                    ..ParsedLine::default()
                },
                Some("web_search") => ParsedLine {
                    activity: Some("Searching the web".to_owned()),
                    ..ParsedLine::default()
                },
                Some("mcp_tool_call") => ParsedLine {
                    activity: Some("Tool · MCP".to_owned()),
                    ..ParsedLine::default()
                },
                _ => ParsedLine::default(),
            }
        }
        Some("error") => {
            let message = obj
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Codex error");
            ParsedLine {
                activity: Some(truncate(message, 240)),
                ..ParsedLine::default()
            }
        }
        // thread.started / turn.started / turn.completed / turn.failed
        // and item.updated: lifecycle / partials — ignored.
        _ => ParsedLine::default(),
    }
}

fn truncate(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ReasoningEffort;

    #[test]
    fn agent_message_completed_becomes_text() {
        let line = serde_json::json!({
            "type": "item.completed",
            "item": { "id": "item_3", "type": "agent_message", "text": "Repo has docs and sdk." }
        })
        .to_string();
        let parsed = parse_codex_line(&line);
        assert_eq!(parsed.text.as_deref(), Some("Repo has docs and sdk."));
        assert!(parsed.edits.is_empty());
        assert!(parsed.activity.is_none());
    }

    #[test]
    fn command_execution_started_becomes_activity() {
        let line = serde_json::json!({
            "type": "item.started",
            "item": { "id": "item_1", "type": "command_execution", "command": "bash -lc ls", "status": "in_progress" }
        })
        .to_string();
        assert_eq!(
            parse_codex_line(&line).activity.as_deref(),
            Some("Running: bash -lc ls")
        );
    }

    #[test]
    fn lifecycle_events_are_ignored() {
        for line in [
            r#"{"type":"thread.started","thread_id":"abc"}"#,
            r#"{"type":"turn.started"}"#,
            r#"{"type":"turn.completed","usage":{"input_tokens":1}}"#,
        ] {
            let parsed = parse_codex_line(line);
            assert!(parsed.text.is_none() && parsed.activity.is_none());
        }
    }

    #[test]
    fn error_event_becomes_activity() {
        let line = r#"{"type":"error","message":"rate limited"}"#;
        assert_eq!(parse_codex_line(line).activity.as_deref(), Some("rate limited"));
    }

    #[test]
    fn non_json_is_ignored() {
        assert!(parse_codex_line("plain text").text.is_none());
    }

    #[test]
    fn codex_info_and_credential() {
        let h = CodexHarness::new();
        assert_eq!(h.info().id, CODEX_HARNESS_ID);
        assert!(h.info().requires_install);
        assert!(!h.credential().required);
    }

    /// Value of the arg immediately following `flag`, if present.
    fn flag_value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
            .map(String::as_str)
    }

    #[test]
    fn codex_args_default_omit_model_and_effort() {
        let args = build_codex_args("hi".to_owned(), RunMode::Ask, &RunTuning::default());
        assert_eq!(args[0], "exec");
        assert!(args.contains(&"--json".to_owned()));
        assert!(!args.iter().any(|a| a == "--model"));
        assert!(!args.iter().any(|a| a == "-c"));
        assert!(!args.iter().any(|a| a == "--full-auto"));
        // Prompt is the trailing positional arg.
        assert_eq!(args.last().map(String::as_str), Some("hi"));
    }

    #[test]
    fn codex_args_carry_model_and_effort_and_ignore_max_turns() {
        let tuning = RunTuning {
            model: Some("gpt-5-codex".to_owned()),
            effort: Some(ReasoningEffort::High),
            max_turns: Some(5),
        };
        let args = build_codex_args("hi".to_owned(), RunMode::Edit, &tuning);
        assert_eq!(flag_value(&args, "--model"), Some("gpt-5-codex"));
        assert_eq!(flag_value(&args, "-c"), Some("model_reasoning_effort=\"high\""));
        assert!(args.contains(&"--full-auto".to_owned()));
        // Codex has no turn-cap flag — max_turns must not leak.
        assert!(!args.iter().any(|a| a == "--max-turns"));
        // Options precede the prompt; the prompt stays last.
        assert_eq!(args.last().map(String::as_str), Some("hi"));
    }
}
