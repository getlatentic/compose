//! Compose's chat-event adapter — where harness output becomes Compose's
//! product-specific UI vocabulary.
//!
//! `agent-harness` is a public library: it returns what each model emits,
//! faithfully, in two tiers — a harness-neutral [`harness::RunEvent`]
//! (default) and bob's untyped raw passthrough ([`harness::parse_bob_raw`],
//! one stdout line → one `serde_json::Value`, opt-in). Neither tier carries
//! Compose's opinions, and that is deliberate. This module is where those
//! opinions live: the three-surface chat model (status indicator / final
//! answer / agent trace) that the front-end renders.
//!
//! Two sources feed one Compose [`ChatEvent`] stream:
//!
//! * **bob → raw.** bob's neutral tier would collapse the distinction
//!   Compose's UI is built on — it promotes `attempt_completion` and a plain
//!   narration message to the *same* `Text`. So Compose consumes bob's *raw*
//!   tier and interprets the JSON itself ([`BobChatMapper`]): the answer
//!   comes only from `attempt_completion`; plain assistant messages are
//!   narration (`Notice`); `<thinking>` is split into reasoning; the
//!   `[using tool …]` echo is dropped (the tool call is represented by its
//!   `tool_use`). Reading bob's `type` discriminator here is Compose's
//!   interpretation, kept out of the shared lib by design.
//!
//! * **claude/codex → neutral.** Their streamed text *is* the answer — no
//!   narration concept — so the neutral tier is exactly right; map it
//!   ~1:1 ([`run_event_to_chat`]). The neutral tier carries no
//!   tool-input/output, session, or usage, so those `ChatEvent` fields stay
//!   empty for these harnesses — an accepted graceful degradation until the
//!   neutral tier gains those facts. Bob, on the raw tier, populates them.
//!
//! [`ChatEvent`] is Compose's own type. Its `#[serde]` shape is the
//! front-end contract (`src/lib/ipc/bobClient.ts` `HarnessRunEvent`): a
//! `kind`-tagged, camelCase union. Keep the two in lockstep.

use bob_rs::ProcessEvent;
use harness::{parse_bob_raw, RunEvent, SuggestedEdit};
use serde::Serialize;
use serde_json::Value;

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
    /// the answer. bob's plain assistant messages; claude/codex don't emit
    /// it.
    Notice { run_id: String, message: String },
    /// Model reasoning → the trace's reasoning accordion.
    Thinking { run_id: String, delta: String },
    /// A tool call began. `input` is the tool's arguments (bob: the
    /// `parameters` object as pretty JSON; claude/codex: `null`).
    ToolStart {
        run_id: String,
        tool_call_id: String,
        name: String,
        input: Option<String>,
    },
    /// A tool call finished. `output` is the tool's result text (bob;
    /// claude/codex: `null`).
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
/// (no narration concept). Tool input/output, session, and usage are absent
/// from the neutral tier, so those fields are `None` here.
pub fn run_event_to_chat(event: RunEvent) -> ChatEvent {
    match event {
        RunEvent::Started { run_id } => ChatEvent::Started { run_id },
        RunEvent::Text { run_id, delta } => ChatEvent::Text { run_id, delta },
        RunEvent::Thinking { run_id, delta } => ChatEvent::Thinking { run_id, delta },
        RunEvent::ToolStart {
            run_id,
            tool_call_id,
            name,
        } => ChatEvent::ToolStart {
            run_id,
            tool_call_id,
            name,
            input: None,
        },
        RunEvent::ToolEnd {
            run_id,
            tool_call_id,
            ok,
        } => ChatEvent::ToolEnd {
            run_id,
            tool_call_id,
            ok,
            output: None,
        },
        RunEvent::SuggestedEdits { run_id, edits } => ChatEvent::SuggestedEdits { run_id, edits },
        RunEvent::Activity { run_id, message } => ChatEvent::Activity { run_id, message },
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
    }
}

/// Compose's interpretation of bob's raw stream, held per-run.
///
/// Stateful because bob streams two things across many lines that Compose
/// must reassemble: reasoning wrapped in `<thinking>…</thinking>` (the tags
/// arrive as their own deltas — [`ThinkingSplitter`]), and the
/// `[using tool …]` narration echo, which Compose drops (it may, in
/// principle, span deltas — [`Self::suppressing_echo`]). One instance per
/// run; the stdout reader thread drives it sequentially.
#[derive(Debug, Default)]
pub struct BobChatMapper {
    splitter: ThinkingSplitter,
    /// True while inside a `[using tool …]` echo whose closing `]` has not
    /// yet arrived — subsequent narration deltas are dropped until it does.
    suppressing_echo: bool,
}

impl BobChatMapper {
    pub fn new() -> Self {
        Self::default()
    }

    /// Translate one raw process event into zero or more [`ChatEvent`]s.
    /// Lifecycle (Started / Exited / Error) and stderr are handled the same
    /// way the neutral skeleton does; only stdout is decoded via bob's raw
    /// tier and interpreted.
    pub fn on_process_event(&mut self, event: ProcessEvent) -> Vec<ChatEvent> {
        match event {
            ProcessEvent::Started { run_id } => vec![ChatEvent::Started { run_id }],
            ProcessEvent::Exited {
                run_id,
                exit_code,
                cancelled,
            } => vec![ChatEvent::Exited {
                run_id,
                exit_code,
                cancelled,
            }],
            ProcessEvent::Error { run_id, message } => vec![ChatEvent::Error { run_id, message }],
            ProcessEvent::Stderr { run_id, line } => {
                let message = truncate(&line, 240);
                if message.is_empty() {
                    vec![]
                } else {
                    vec![ChatEvent::Activity { run_id, message }]
                }
            }
            ProcessEvent::Stdout { run_id, line } => self.map_raw(parse_bob_raw(&line), &run_id),
        }
    }

    /// The interpretation core: one raw stdout line (decoded JSON) → Compose
    /// surfaces. bob emits one object per line with a snake_case `type`
    /// discriminator; reading it is Compose's interpretation (the lib's raw
    /// tier imposes no schema — see [`parse_bob_raw`]).
    fn map_raw(&mut self, value: Value, run_id: &str) -> Vec<ChatEvent> {
        let mut out = Vec::new();
        // A non-object decode — a non-JSON line surfaced as a JSON string, or
        // a blank line as null — carries nothing Compose surfaces.
        let Some(obj) = value.as_object() else {
            return out;
        };
        match obj.get("type").and_then(Value::as_str) {
            // Run identity → trace. Skip if bob omitted the id (the wire
            // contract needs a string `sessionId`).
            Some("init") => {
                if let Some(session_id) = obj.get("session_id").and_then(Value::as_str) {
                    out.push(ChatEvent::Session {
                        run_id: run_id.to_owned(),
                        session_id: session_id.to_owned(),
                        model: obj.get("model").and_then(Value::as_str).map(str::to_owned),
                    });
                }
            }
            // A conversation message. Only the assistant's own output is
            // surfaced — the echoed `user` prompt is dropped. Its text is
            // narration (`Notice`), never the answer; `<thinking>` is split
            // out as reasoning; the `[using tool …]` echo is suppressed.
            Some("message") => {
                if obj.get("role").and_then(Value::as_str) == Some("assistant") {
                    let content = obj.get("content").and_then(Value::as_str).unwrap_or_default();
                    let (text, thinking) = self.splitter.split(content);
                    if let Some(thinking) = thinking {
                        out.push(ChatEvent::Thinking {
                            run_id: run_id.to_owned(),
                            delta: thinking,
                        });
                    }
                    if let Some(text) = text {
                        if let Some(message) = self.narration_after_echo(text) {
                            out.push(ChatEvent::Notice {
                                run_id: run_id.to_owned(),
                                message,
                            });
                        }
                    }
                }
            }
            // A tool call. bob delivers its final answer through the
            // `attempt_completion` tool (grounded in a real run): surface
            // its `result` as the answer text. Every other tool is a real
            // action → a tool card with its arguments as `input`.
            Some("tool_use") => {
                let tool_name = obj.get("tool_name").and_then(Value::as_str).unwrap_or_default();
                if tool_name == "attempt_completion" {
                    if let Some(result) = obj
                        .get("parameters")
                        .and_then(|p| p.get("result"))
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                    {
                        out.push(ChatEvent::Text {
                            run_id: run_id.to_owned(),
                            delta: result.to_owned(),
                        });
                    }
                } else {
                    out.push(ChatEvent::ToolStart {
                        run_id: run_id.to_owned(),
                        tool_call_id: obj
                            .get("tool_id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_owned(),
                        name: tool_name.to_owned(),
                        input: parameters_to_input(obj.get("parameters")),
                    });
                }
            }
            // A tool's outcome → close the card. bob's own `status` term:
            // anything other than "error" is success.
            Some("tool_result") => {
                out.push(ChatEvent::ToolEnd {
                    run_id: run_id.to_owned(),
                    tool_call_id: obj
                        .get("tool_id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                    ok: obj.get("status").and_then(Value::as_str) != Some("error"),
                    output: obj.get("output").and_then(Value::as_str).map(str::to_owned),
                });
            }
            // Terminal stats → usage float. Coins are bob's `session_costs`.
            Some("result") => {
                let stats = obj.get("stats");
                let number = |key: &str| stats.and_then(|s| s.get(key)).and_then(as_number_i64);
                out.push(ChatEvent::Usage {
                    run_id: run_id.to_owned(),
                    total_tokens: number("total_tokens"),
                    tool_calls: number("tool_calls"),
                    coins: number("session_costs"),
                });
            }
            // Unknown `type`, no `type`, or a future event bob invents: it is
            // neither answer nor structured narration, so Compose drops it
            // rather than risk polluting the bubble. (The raw tier preserves
            // it; this is Compose choosing not to surface it.)
            _ => {}
        }
        out
    }

    /// Given the non-thinking (visible) portion of an assistant message,
    /// return the narration to surface, or `None` if it is the
    /// `[using tool …]` echo Compose drops. Tracks an echo that spans
    /// deltas via [`Self::suppressing_echo`].
    fn narration_after_echo(&mut self, text: String) -> Option<String> {
        if self.suppressing_echo {
            // Still inside an unterminated echo — drop until its `]`.
            if text.contains(']') {
                self.suppressing_echo = false;
            }
            return None;
        }
        if text.trim_start().starts_with("[using tool") {
            // Start of the echo. If its `]` isn't in this delta, keep
            // dropping subsequent deltas until it arrives.
            if !text.contains(']') {
                self.suppressing_echo = true;
            }
            return None;
        }
        Some(text)
    }
}

/// The `<thinking>…</thinking>` state machine, owned by Compose because
/// surfacing reasoning is Compose's choice. bob streams reasoning inline in
/// assistant message content with the tags arriving as their own deltas, so
/// routing it requires tracking the open/closed state *across* lines.
///
/// (Mirrors the neutral tier's `BobStreamParser` thinking logic; the
/// duplication is intentional — the neutral and Compose tiers each own their
/// interpretation rather than sharing one.)
#[derive(Debug, Default)]
struct ThinkingSplitter {
    in_thinking: bool,
}

impl ThinkingSplitter {
    /// Split an assistant content chunk into `(visible text, thinking)`,
    /// honoring the markers and the carried-over `in_thinking` state.
    /// Handles tags split across chunks and multiple tags in one chunk.
    fn split(&mut self, content: &str) -> (Option<String>, Option<String>) {
        const OPEN: &str = "<thinking>";
        const CLOSE: &str = "</thinking>";
        let mut text = String::new();
        let mut thinking = String::new();
        let mut rest = content;
        loop {
            if self.in_thinking {
                match rest.find(CLOSE) {
                    Some(i) => {
                        thinking.push_str(&rest[..i]);
                        self.in_thinking = false;
                        rest = &rest[i + CLOSE.len()..];
                    }
                    None => {
                        thinking.push_str(rest);
                        break;
                    }
                }
            } else {
                match rest.find(OPEN) {
                    Some(i) => {
                        text.push_str(&rest[..i]);
                        self.in_thinking = true;
                        rest = &rest[i + OPEN.len()..];
                    }
                    None => {
                        text.push_str(rest);
                        break;
                    }
                }
            }
        }
        (
            (!text.is_empty()).then_some(text),
            (!thinking.is_empty()).then_some(thinking),
        )
    }
}

/// Serialize a tool's `parameters` for the trace's `input` field: pretty
/// JSON, or `None` when there are no parameters (absent, or bob sent `null`).
fn parameters_to_input(parameters: Option<&Value>) -> Option<String> {
    match parameters {
        None | Some(Value::Null) => None,
        Some(other) => serde_json::to_string_pretty(other).ok(),
    }
}

/// Read a JSON stats field as `i64`, tolerating integer or float encodings
/// (bob's counts are integers, but a float like `3.0` shouldn't drop to
/// `None`). Absent / non-numeric → `None`.
fn as_number_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().map(|u| u as i64))
        .or_else(|| value.as_f64().map(|f| f as i64))
}

/// First `max_chars` characters (not bytes) of `s` — bounds a stderr
/// activity line without splitting a multi-byte char. (Mirrors the neutral
/// skeleton's private `truncate`.)
fn truncate(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(line: &str) -> Value {
        parse_bob_raw(line)
    }

    // --- bob raw → ChatEvent interpretation ---------------------------------

    #[test]
    fn assistant_narration_becomes_notice_not_answer() {
        let mut m = BobChatMapper::new();
        let out = m.map_raw(
            raw(r#"{"type":"message","role":"assistant","content":"Let me look at the docs."}"#),
            "r",
        );
        assert_eq!(
            out,
            vec![ChatEvent::Notice {
                run_id: "r".to_owned(),
                message: "Let me look at the docs.".to_owned(),
            }]
        );
    }

    #[test]
    fn echoed_user_prompt_is_dropped() {
        let mut m = BobChatMapper::new();
        assert!(m
            .map_raw(
                raw(r#"{"type":"message","role":"user","content":"list files"}"#),
                "r",
            )
            .is_empty());
    }

    #[test]
    fn using_tool_echo_is_dropped() {
        let mut m = BobChatMapper::new();
        assert!(m
            .map_raw(
                raw(r#"{"type":"message","role":"assistant","content":"[using tool list_files: /x/docs]"}"#),
                "r",
            )
            .is_empty());
    }

    #[test]
    fn chunked_using_tool_echo_is_dropped_across_deltas() {
        let mut m = BobChatMapper::new();
        let msg = |c: &str| {
            format!(
                r#"{{"type":"message","role":"assistant","content":{},"delta":true}}"#,
                serde_json::to_string(c).unwrap()
            )
        };
        assert!(m.map_raw(raw(&msg("[using tool list_files: ")), "r").is_empty());
        assert!(m.map_raw(raw(&msg("/x/docs")), "r").is_empty());
        assert!(m.map_raw(raw(&msg("]")), "r").is_empty());
        // Echo closed — real narration flows again.
        assert_eq!(
            m.map_raw(raw(&msg("Done.")), "r"),
            vec![ChatEvent::Notice {
                run_id: "r".to_owned(),
                message: "Done.".to_owned(),
            }]
        );
    }

    #[test]
    fn thinking_is_split_out_of_narration() {
        let mut m = BobChatMapper::new();
        let out = m.map_raw(
            raw(r#"{"type":"message","role":"assistant","content":"<thinking>weighing options</thinking>Here goes."}"#),
            "r",
        );
        assert_eq!(
            out,
            vec![
                ChatEvent::Thinking {
                    run_id: "r".to_owned(),
                    delta: "weighing options".to_owned(),
                },
                ChatEvent::Notice {
                    run_id: "r".to_owned(),
                    message: "Here goes.".to_owned(),
                },
            ]
        );
    }

    #[test]
    fn thinking_state_carries_across_deltas() {
        let mut m = BobChatMapper::new();
        let msg = |c: &str| {
            format!(
                r#"{{"type":"message","role":"assistant","content":{},"delta":true}}"#,
                serde_json::to_string(c).unwrap()
            )
        };
        // Open tag in its own delta → the trailing newline is reasoning.
        assert_eq!(
            m.map_raw(raw(&msg("<thinking>\n")), "r"),
            vec![ChatEvent::Thinking {
                run_id: "r".to_owned(),
                delta: "\n".to_owned(),
            }]
        );
        // Mid-block → still reasoning (state carried).
        assert_eq!(
            m.map_raw(raw(&msg("the user wants X")), "r"),
            vec![ChatEvent::Thinking {
                run_id: "r".to_owned(),
                delta: "the user wants X".to_owned(),
            }]
        );
        // Close + answer-ish narration in one delta → split, narration → notice.
        assert_eq!(
            m.map_raw(raw(&msg("</thinking>On it.")), "r"),
            vec![ChatEvent::Notice {
                run_id: "r".to_owned(),
                message: "On it.".to_owned(),
            }]
        );
    }

    #[test]
    fn attempt_completion_becomes_answer_text() {
        let mut m = BobChatMapper::new();
        let out = m.map_raw(
            raw(r#"{"type":"tool_use","tool_id":"t2","tool_name":"attempt_completion","parameters":{"result":"The answer is 42."}}"#),
            "r",
        );
        assert_eq!(
            out,
            vec![ChatEvent::Text {
                run_id: "r".to_owned(),
                delta: "The answer is 42.".to_owned(),
            }]
        );
    }

    #[test]
    fn empty_attempt_completion_emits_nothing() {
        let mut m = BobChatMapper::new();
        assert!(m
            .map_raw(
                raw(r#"{"type":"tool_use","tool_id":"t2","tool_name":"attempt_completion","parameters":{"result":""}}"#),
                "r",
            )
            .is_empty());
    }

    #[test]
    fn real_tool_use_becomes_tool_start_with_input() {
        let mut m = BobChatMapper::new();
        let out = m.map_raw(
            raw(r#"{"type":"tool_use","tool_id":"t1","tool_name":"list_files","parameters":{"dir_path":"/x/docs"}}"#),
            "r",
        );
        let [ChatEvent::ToolStart {
            run_id,
            tool_call_id,
            name,
            input,
        }] = out.as_slice() else {
            panic!("expected one ToolStart, got {out:?}");
        };
        assert_eq!(run_id, "r");
        assert_eq!(tool_call_id, "t1");
        assert_eq!(name, "list_files");
        // input is the parameters object as JSON (pretty-printed).
        let input = input.as_ref().expect("input present");
        assert!(input.contains("dir_path"));
        assert!(input.contains("/x/docs"));
    }

    #[test]
    fn tool_result_becomes_tool_end() {
        let mut m = BobChatMapper::new();
        assert_eq!(
            m.map_raw(
                raw(r#"{"type":"tool_result","tool_id":"t1","status":"success","output":"Listed 11 item(s)."}"#),
                "r",
            ),
            vec![ChatEvent::ToolEnd {
                run_id: "r".to_owned(),
                tool_call_id: "t1".to_owned(),
                ok: true,
                output: Some("Listed 11 item(s).".to_owned()),
            }]
        );
        assert_eq!(
            m.map_raw(
                raw(r#"{"type":"tool_result","tool_id":"t2","status":"error","output":"boom"}"#),
                "r",
            ),
            vec![ChatEvent::ToolEnd {
                run_id: "r".to_owned(),
                tool_call_id: "t2".to_owned(),
                ok: false,
                output: Some("boom".to_owned()),
            }]
        );
    }

    #[test]
    fn init_becomes_session() {
        let mut m = BobChatMapper::new();
        assert_eq!(
            m.map_raw(raw(r#"{"type":"init","session_id":"s","model":"premium"}"#), "r"),
            vec![ChatEvent::Session {
                run_id: "r".to_owned(),
                session_id: "s".to_owned(),
                model: Some("premium".to_owned()),
            }]
        );
    }

    #[test]
    fn result_becomes_usage_with_coins_from_session_costs() {
        let mut m = BobChatMapper::new();
        assert_eq!(
            m.map_raw(
                raw(r#"{"type":"result","status":"success","stats":{"total_tokens":1280,"session_costs":3,"tool_calls":2}}"#),
                "r",
            ),
            vec![ChatEvent::Usage {
                run_id: "r".to_owned(),
                total_tokens: Some(1280),
                tool_calls: Some(2),
                coins: Some(3),
            }]
        );
    }

    #[test]
    fn stderr_becomes_truncated_activity() {
        let mut m = BobChatMapper::new();
        let out = m.on_process_event(ProcessEvent::Stderr {
            run_id: "r".to_owned(),
            line: "x".repeat(500),
        });
        let [ChatEvent::Activity { message, .. }] = out.as_slice() else {
            panic!("expected one Activity, got {out:?}");
        };
        assert_eq!(message.chars().count(), 240);
    }

    #[test]
    fn full_grounded_bob_turn_maps_to_the_three_surfaces() {
        // The grounded bob 1.0.4 sequence, end to end, through Compose's
        // interpretation: reasoning → trace, tool → card, answer → bubble.
        let mut m = BobChatMapper::new();
        let stdout = |line: &str| ProcessEvent::Stdout {
            run_id: "r".to_owned(),
            line: line.to_owned(),
        };

        assert!(m
            .on_process_event(stdout(r#"{"type":"init","session_id":"s","model":"premium"}"#))
            .iter()
            .any(|e| matches!(e, ChatEvent::Session { .. })));
        // user echo → nothing
        assert!(m
            .on_process_event(stdout(r#"{"type":"message","role":"user","content":"list files"}"#))
            .is_empty());
        // reasoning → thinking
        assert!(matches!(
            m.on_process_event(stdout(
                r#"{"type":"message","role":"assistant","content":"<thinking>\n","delta":true}"#
            ))
            .as_slice(),
            [ChatEvent::Thinking { .. }]
        ));
        let _ = m.on_process_event(stdout(
            r#"{"type":"message","role":"assistant","content":"</thinking>\n","delta":true}"#,
        ));
        // tool start / end
        assert!(matches!(
            m.on_process_event(stdout(
                r#"{"type":"tool_use","tool_name":"list_files","tool_id":"tool-1","parameters":{"dir_path":"/x/docs"}}"#
            ))
            .as_slice(),
            [ChatEvent::ToolStart { .. }]
        ));
        assert!(matches!(
            m.on_process_event(stdout(
                r#"{"type":"tool_result","tool_id":"tool-1","status":"success","output":"Listed 11 item(s)."}"#
            ))
            .as_slice(),
            [ChatEvent::ToolEnd { ok: true, .. }]
        ));
        // answer
        assert!(matches!(
            m.on_process_event(stdout(
                r#"{"type":"tool_use","tool_id":"tool-2","tool_name":"attempt_completion","parameters":{"result":"The docs directory contains 10 files."}}"#
            ))
            .as_slice(),
            [ChatEvent::Text { delta, .. }] if delta == "The docs directory contains 10 files."
        ));
        // usage
        assert!(matches!(
            m.on_process_event(stdout(
                r#"{"type":"result","status":"success","stats":{"total_tokens":10,"session_costs":1,"tool_calls":2}}"#
            ))
            .as_slice(),
            [ChatEvent::Usage { coins: Some(1), .. }]
        ));
    }

    // --- neutral RunEvent → ChatEvent (claude/codex) ------------------------

    #[test]
    fn neutral_text_is_the_answer() {
        assert_eq!(
            run_event_to_chat(RunEvent::Text {
                run_id: "r".to_owned(),
                delta: "hello".to_owned(),
            }),
            ChatEvent::Text {
                run_id: "r".to_owned(),
                delta: "hello".to_owned(),
            }
        );
    }

    #[test]
    fn neutral_tool_events_have_no_io() {
        assert_eq!(
            run_event_to_chat(RunEvent::ToolStart {
                run_id: "r".to_owned(),
                tool_call_id: "t".to_owned(),
                name: "shell".to_owned(),
            }),
            ChatEvent::ToolStart {
                run_id: "r".to_owned(),
                tool_call_id: "t".to_owned(),
                name: "shell".to_owned(),
                input: None,
            }
        );
        assert_eq!(
            run_event_to_chat(RunEvent::ToolEnd {
                run_id: "r".to_owned(),
                tool_call_id: "t".to_owned(),
                ok: true,
            }),
            ChatEvent::ToolEnd {
                run_id: "r".to_owned(),
                tool_call_id: "t".to_owned(),
                ok: true,
                output: None,
            }
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
        })
        .unwrap();
        assert_eq!(json["kind"], "toolStart");
        assert_eq!(json["runId"], "r1");
        assert_eq!(json["toolCallId"], "tc");
        assert_eq!(json["name"], "list_files");
        assert_eq!(json["input"], "{}");

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
