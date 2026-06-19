//! Compose's chat-event adapter — where harness output becomes Compose's
//! product-specific UI vocabulary.
//!
//! `agent-harness` is a public library: it returns what each model emits
//! faithfully as a harness-neutral [`harness::RunEvent`], which carries none
//! of Compose's opinions. This module is where those opinions live: the
//! three-surface chat model (status indicator / final answer / agent trace)
//! that the front-end renders.
//!
//! Every harness — bob included — now runs through the registry and reaches
//! this module as a neutral [`RunEvent`], mapped ~1:1 to a [`ChatEvent`] by
//! [`run_event_to_chat`]. Their streamed text *is* the answer (no narration
//! concept), and the neutral tier also carries session identity, token usage,
//! and tool input/output, so those `ChatEvent` fields are populated. Only the
//! bob-specific stats stay empty (`tool_calls` / `coins`), plus Claude's tool
//! *input* (it streams incrementally rather than arriving inline).
//!
//! [`ChatEvent`] is Compose's own type. Its `#[serde]` shape is the
//! front-end contract (`src/lib/ipc/bobClient.ts` `HarnessRunEvent`): a
//! `kind`-tagged, camelCase union. Keep the two in lockstep.

use harness::{RunEvent, SuggestedEdit, ToolKind};
use serde::Serialize;

/// Compose's run-event vocabulary — the three-surface chat model on the
/// wire. Serializes to `bobClient.ts`'s `HarnessRunEvent`; the
/// `Option` fields serialize as `null` (never omitted) to match the
/// `T | null` front-end types.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ChatEvent {
    /// Run started — the front-end flips to "starting".
    Started { run_id: String },
    /// A chunk of the **answer** → the message bubble. For bob this is only
    /// the `attempt_completion` result; for claude/codex the streamed text.
    Text { run_id: String, delta: String },
    /// Process narration ("what I'm doing") → live status + trace. *Not*
    /// the answer. No harness produces it today — the neutral tier has no
    /// narration concept (claude/codex stream their text as the answer), and
    /// bob's old raw-stream interpretation that mapped plain assistant
    /// messages here is gone. Retained because it is part of the front-end
    /// wire union (`bobClient.ts` `HarnessRunEvent`; `workspaceStore` handles
    /// `case "notice"`): the Rust enum and the TS union are kept in lockstep,
    /// so the variant stays even with no current Rust producer.
    #[allow(dead_code)]
    Notice { run_id: String, message: String },
    /// Model reasoning → the trace's reasoning accordion.
    Thinking { run_id: String, delta: String },
    /// A tool call began. `input` is the tool's arguments: bob's
    /// `parameters` and codex's `command`; `null` for Claude (it streams
    /// args incrementally, so they don't arrive inline). `tool_kind` is the
    /// neutral behaviour class (read / write / edit / …) the front-end routes
    /// on — sourced from the harness, never re-derived from `name` downstream.
    ToolStart {
        run_id: String,
        tool_call_id: String,
        name: String,
        input: Option<String>,
        tool_kind: ToolKind,
    },
    /// A tool call finished. `output` is the tool's result text — bob's
    /// `tool_result.output`, codex's `aggregated_output`, Claude's
    /// `tool_result.content`.
    ToolEnd {
        run_id: String,
        tool_call_id: String,
        ok: bool,
        output: Option<String>,
    },
    /// Harness session identity (bob's `init`) → trace.
    Session {
        run_id: String,
        session_id: String,
        model: Option<String>,
    },
    /// Proposed edits (bob). The app prepares + previews them.
    SuggestedEdits {
        run_id: String,
        edits: Vec<SuggestedEdit>,
    },
    /// A transient status line (stderr / progress).
    Activity { run_id: String, message: String },
    /// Terminal usage stats (bob's `result.stats`) → the stats float.
    Usage {
        run_id: String,
        total_tokens: Option<i64>,
        tool_calls: Option<i64>,
        coins: Option<i64>,
    },
    /// Spawn / IO / parse failure. Terminal — followed by `Exited`.
    Error { run_id: String, message: String },
    /// The run finished. Sent exactly once.
    Exited {
        run_id: String,
        exit_code: Option<i32>,
        cancelled: bool,
    },
}

/// Map a neutral [`RunEvent`] (claude/codex) to a [`ChatEvent`], ~1:1.
/// Their streamed `Text` is the answer, so it maps to [`ChatEvent::Text`]
/// (no narration concept). The neutral tier now carries session identity,
/// token usage, and tool input/output, so those pass straight through —
/// reaching bob's fidelity. Only the bob-specific stats stay `None`:
/// `tool_calls` + `coins` live in bob's raw `result.stats`, not the neutral
/// tier (and Claude's tool *input* is `None` upstream — it streams
/// incrementally rather than arriving inline). Returns `None` for a future
/// `#[non_exhaustive]` `RunEvent` variant Compose doesn't model yet.
pub fn run_event_to_chat(event: RunEvent) -> Option<ChatEvent> {
    Some(match event {
        RunEvent::Started { run_id } => ChatEvent::Started { run_id },
        RunEvent::Session {
            run_id,
            session_id,
            model,
        } => ChatEvent::Session {
            run_id,
            // claude/codex always report an id; default defensively otherwise.
            session_id: session_id.unwrap_or_default(),
            model,
        },
        RunEvent::Text { run_id, delta } => ChatEvent::Text { run_id, delta },
        RunEvent::Thinking { run_id, delta } => ChatEvent::Thinking { run_id, delta },
        // 0.4 renamed these to ACP's ToolCall shape (title/raw_input/content) and
        // added locations/raw_output. Map onto Compose's existing ChatEvent so the
        // front-end wire shape is unchanged; the new fields aren't surfaced yet.
        RunEvent::ToolStart {
            run_id,
            tool_call_id,
            title,
            tool_kind,
            raw_input,
            locations: _,
        } => ChatEvent::ToolStart {
            run_id,
            tool_call_id,
            name: title,
            input: raw_input,
            tool_kind,
        },
        RunEvent::ToolEnd {
            run_id,
            tool_call_id,
            ok,
            content,
            raw_output: _,
            locations: _,
        } => ChatEvent::ToolEnd {
            run_id,
            tool_call_id,
            ok,
            output: content,
        },
        RunEvent::SuggestedEdits { run_id, edits } => ChatEvent::SuggestedEdits { run_id, edits },
        RunEvent::Activity { run_id, message } => ChatEvent::Activity { run_id, message },
        RunEvent::Usage {
            run_id,
            total_tokens,
            ..
        } => ChatEvent::Usage {
            run_id,
            // Neutral total → the stats float. `tool_calls` + `coins` are
            // bob-specific (from bob's raw stats), so absent for claude/codex.
            total_tokens: total_tokens.map(|t| t as i64),
            tool_calls: None,
            coins: None,
        },
        RunEvent::Error { run_id, message } => ChatEvent::Error { run_id, message },
        RunEvent::Exited {
            run_id,
            exit_code,
            cancelled,
        } => ChatEvent::Exited {
            run_id,
            exit_code,
            cancelled,
        },
        // `RunEvent` is `#[non_exhaustive]`: a future neutral variant Compose
        // doesn't model yet maps to no `ChatEvent` — drop it, don't guess.
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use harness::ProcessEvent;

    // --- neutral RunEvent → ChatEvent (claude/codex) ------------------------

    #[test]
    fn neutral_text_is_the_answer() {
        assert_eq!(
            run_event_to_chat(RunEvent::Text {
                run_id: "r".to_owned(),
                delta: "hello".to_owned(),
            }),
            Some(ChatEvent::Text {
                run_id: "r".to_owned(),
                delta: "hello".to_owned(),
            })
        );
    }

    #[test]
    fn neutral_tool_events_carry_io() {
        // The enriched neutral tier now carries tool input/output (codex/bob);
        // run_event_to_chat passes them straight through.
        assert_eq!(
            run_event_to_chat(RunEvent::ToolStart {
                run_id: "r".to_owned(),
                tool_call_id: "t".to_owned(),
                title: "shell".to_owned(),
                tool_kind: ToolKind::Execute,
                raw_input: Some("ls -la".to_owned()),
                locations: Vec::new(),
            }),
            Some(ChatEvent::ToolStart {
                run_id: "r".to_owned(),
                tool_call_id: "t".to_owned(),
                name: "shell".to_owned(),
                input: Some("ls -la".to_owned()),
                tool_kind: ToolKind::Execute,
            })
        );
        assert_eq!(
            run_event_to_chat(RunEvent::ToolEnd {
                run_id: "r".to_owned(),
                tool_call_id: "t".to_owned(),
                ok: true,
                content: Some("done".to_owned()),
                raw_output: None,
                locations: Vec::new(),
            }),
            Some(ChatEvent::ToolEnd {
                run_id: "r".to_owned(),
                tool_call_id: "t".to_owned(),
                ok: true,
                output: Some("done".to_owned()),
            })
        );
    }

    #[test]
    fn neutral_session_and_usage_map_through() {
        assert_eq!(
            run_event_to_chat(RunEvent::Session {
                run_id: "r".to_owned(),
                session_id: Some("sess-1".to_owned()),
                model: Some("opus".to_owned()),
            }),
            Some(ChatEvent::Session {
                run_id: "r".to_owned(),
                session_id: "sess-1".to_owned(),
                model: Some("opus".to_owned()),
            })
        );
        // Neutral usage → stats float; tool_calls + coins are bob-only → None.
        assert_eq!(
            run_event_to_chat(RunEvent::Usage {
                run_id: "r".to_owned(),
                input_tokens: Some(100),
                output_tokens: Some(40),
                total_tokens: Some(140),
                cache_read_tokens: None,
                cache_write_tokens: None,
                cost_usd: None,
            }),
            Some(ChatEvent::Usage {
                run_id: "r".to_owned(),
                total_tokens: Some(140),
                tool_calls: None,
                coins: None,
            })
        );
    }

    #[test]
    fn neutral_error_maps_to_chat_error() {
        // The arm a failing codex/claude run relies on: an in-band
        // RunEvent::Error becomes a ChatEvent::Error (which the frontend
        // finalizes into a system bubble). Untested until agent-harness 0.3.0
        // made codex failures reach RunEvent::Error at all.
        assert_eq!(
            run_event_to_chat(RunEvent::Error {
                run_id: "r".to_owned(),
                message: "context window exceeded".to_owned(),
            }),
            Some(ChatEvent::Error {
                run_id: "r".to_owned(),
                message: "context window exceeded".to_owned(),
            })
        );
    }

    #[test]
    fn failing_codex_turn_surfaces_a_chat_error() {
        // End-to-end on the real (published 0.3.0) codex path: a `turn.failed`
        // stdout line → harness::codex::CodexStreamParser → RunEvent::Error →
        // run_event_to_chat → ChatEvent::Error. This is exactly the bug the
        // 0.3.0 bump fixes — before it, the failure produced no answer AND no
        // error, so the run looked like codex silently did nothing.
        use harness::codex::CodexStreamParser;
        let mut parser = CodexStreamParser::new();
        let run_events = parser.on_process_event(ProcessEvent::Stdout {
            run_id: "r".to_owned(),
            line: r#"{"type":"turn.failed","error":{"message":"quota exceeded"}}"#.to_owned(),
        });
        let chat: Vec<ChatEvent> = run_events.into_iter().filter_map(run_event_to_chat).collect();
        assert!(
            chat.iter().any(|e| matches!(
                e,
                ChatEvent::Error { message, .. } if message == "quota exceeded"
            )),
            "a failing codex turn must surface a ChatEvent::Error, got {chat:?}"
        );
    }

    // --- wire contract (must match bobClient.ts HarnessRunEvent) ------------

    #[test]
    fn chat_event_serializes_kind_tagged_camelcase() {
        let json = serde_json::to_value(ChatEvent::ToolStart {
            run_id: "r1".to_owned(),
            tool_call_id: "tc".to_owned(),
            name: "list_files".to_owned(),
            input: Some("{}".to_owned()),
            tool_kind: ToolKind::Search,
        })
        .unwrap();
        assert_eq!(json["kind"], "toolStart");
        assert_eq!(json["runId"], "r1");
        assert_eq!(json["toolCallId"], "tc");
        assert_eq!(json["name"], "list_files");
        assert_eq!(json["input"], "{}");
        // Neutral class rides as `toolKind` (camelCase enum) — the key the
        // front-end reads; distinct from the `kind` event discriminator.
        assert_eq!(json["toolKind"], "search");

        // Optional fields serialize as null (not omitted) to match the
        // `T | null` front-end types.
        let usage = serde_json::to_value(ChatEvent::Usage {
            run_id: "r1".to_owned(),
            total_tokens: Some(5),
            tool_calls: None,
            coins: Some(2),
        })
        .unwrap();
        assert_eq!(usage["kind"], "usage");
        assert_eq!(usage["totalTokens"], 5);
        assert!(usage.get("toolCalls").is_some());
        assert!(usage["toolCalls"].is_null());
        assert_eq!(usage["coins"], 2);

        let session = serde_json::to_value(ChatEvent::Session {
            run_id: "r1".to_owned(),
            session_id: "s".to_owned(),
            model: None,
        })
        .unwrap();
        assert_eq!(session["kind"], "session");
        assert_eq!(session["sessionId"], "s");
        assert!(session["model"].is_null());

        let exited = serde_json::to_value(ChatEvent::Exited {
            run_id: "r1".to_owned(),
            exit_code: Some(0),
            cancelled: false,
        })
        .unwrap();
        assert_eq!(exited["kind"], "exited");
        assert_eq!(exited["exitCode"], 0);
        assert_eq!(exited["cancelled"], false);
    }
}
