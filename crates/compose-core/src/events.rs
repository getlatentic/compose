//! Normalized run events — the one shape the UI consumes regardless
//! of which harness produced them.
//!
//! Every adapter (bob's stream-json, Claude Code's stream-json,
//! Codex's format, a raw-API agent loop) parses its own wire format
//! into these variants *on the Rust side*. The front-end then learns
//! exactly one event vocabulary and never grows a per-harness
//! parser. This is the keystone of the harness abstraction: the cost
//! of adding a harness is "write a parser into `RunEvent`," not
//! "teach the UI another format."
//!
//! Suggested edits carry only the *raw* edit (path + byte range +
//! replacement). Turning those into previewable drafts needs the
//! workspace file content and the coordinate mapper, which live in
//! the TS app layer (`prepareWorkspaceSuggestionDrafts`), so that
//! step stays there — this module's job is just to lift the edit out
//! of the harness's bespoke wire format.

use serde::Serialize;
use serde_json::Value;

use bob_core::BobRunEvent;

/// A UTF-8 byte range into a document. Mirrors the persisted
/// `ByteOffset` discipline (see `docs/editor-guide.md`): positions
/// crossing the harness boundary are bytes, never code units.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ByteRange {
    pub start: u64,
    pub end: u64,
}

/// A raw suggested edit emitted by a harness. The app layer prepares
/// these into previewable drafts; this is the transport shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedEdit {
    pub file_path: String,
    pub range: ByteRange,
    pub replacement: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// The normalized event stream. `#[serde(tag = "kind")]` +
/// camelCase mirrors the existing `BobRunEvent` wire contract the TS
/// store already reads (`event.kind`, `event.runId`, …), so the
/// front-end migration in the live-rewire step is a switch arm swap,
/// not a protocol change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
// `rename_all` camelCases the variant tags ("suggestedEdits"); serde
// does NOT cascade that to struct-variant fields, so `rename_all_fields`
// is required to get `runId` / `exitCode` on the wire rather than the
// snake_case Rust idents.
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RunEvent {
    /// First event, before any output. UI shows "thinking…".
    Started { run_id: String },
    /// A chunk of assistant text. Appended to the active message.
    Text { run_id: String, delta: String },
    /// A chunk of model reasoning ("thinking"), rendered distinctly from
    /// `Text` so the UI can show reasoning without mixing it into the
    /// answer (e.g. Claude's `thinking_delta`).
    Thinking { run_id: String, delta: String },
    /// One or more proposed edits. The app prepares + previews them.
    SuggestedEdits {
        run_id: String,
        edits: Vec<SuggestedEdit>,
    },
    /// A human-readable status line (tool call, file touch, edit
    /// count). Replaces the message's transient activity text.
    Activity { run_id: String, message: String },
    /// Spawn / IO / parse failure. Terminal — followed by `Exited`.
    Error { run_id: String, message: String },
    /// The run finished. Sent exactly once.
    Exited {
        run_id: String,
        exit_code: Option<i32>,
        cancelled: bool,
    },
}

/// What a single harness output line decoded to. A line can yield
/// text *and* edits at once, so this is not one-event-per-line.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ParsedLine {
    pub text: Option<String>,
    /// Model reasoning chunk → `RunEvent::Thinking`. Kept separate from
    /// `text` so the UI can render it distinctly.
    pub thinking: Option<String>,
    pub edits: Vec<SuggestedEdit>,
    pub activity: Option<String>,
}

impl ParsedLine {
    /// True when a line decoded to no actionable content. Used by the
    /// tests; `normalize_bob_event` relies on the natural no-op of
    /// pushing zero events instead.
    #[cfg(test)]
    fn is_empty(&self) -> bool {
        self.text.is_none()
            && self.thinking.is_none()
            && self.edits.is_empty()
            && self.activity.is_none()
    }
}

/// Translate one raw process event into zero or more normalized
/// [`RunEvent`]s, using `parse_line` to decode the harness's stdout
/// wire format. Lifecycle events (Started / Exited / Error) and
/// stderr are harness-neutral and handled here; only the stdout
/// parsing differs per harness — so every process-backed adapter
/// shares this skeleton and supplies just its own line parser.
pub fn normalize_process_event(
    event: BobRunEvent,
    parse_line: impl Fn(&str) -> ParsedLine,
) -> Vec<RunEvent> {
    match event {
        BobRunEvent::Started { run_id } => vec![RunEvent::Started { run_id }],
        BobRunEvent::Exited {
            run_id,
            exit_code,
            cancelled,
        } => vec![RunEvent::Exited {
            run_id,
            exit_code,
            cancelled,
        }],
        BobRunEvent::Error { run_id, message } => vec![RunEvent::Error { run_id, message }],
        BobRunEvent::Stderr { run_id, line } => {
            // stderr is warnings/progress; surface as activity,
            // truncated like the TS store did (240 chars).
            let message = truncate(&line, 240);
            if message.is_empty() {
                vec![]
            } else {
                vec![RunEvent::Activity { run_id, message }]
            }
        }
        BobRunEvent::Stdout { run_id, line } => {
            let parsed = parse_line(&line);
            let mut out = Vec::new();
            if let Some(text) = parsed.text {
                out.push(RunEvent::Text {
                    run_id: run_id.clone(),
                    delta: text,
                });
            }
            if let Some(thinking) = parsed.thinking {
                out.push(RunEvent::Thinking {
                    run_id: run_id.clone(),
                    delta: thinking,
                });
            }
            if !parsed.edits.is_empty() {
                out.push(RunEvent::SuggestedEdits {
                    run_id: run_id.clone(),
                    edits: parsed.edits,
                });
            }
            if let Some(activity) = parsed.activity {
                out.push(RunEvent::Activity {
                    run_id,
                    message: activity,
                });
            }
            out
        }
    }
}

/// bob's adapter-side normalization: parse bob's `--output-format
/// stream-json` stdout via [`parse_bob_line`].
pub fn normalize_bob_event(event: BobRunEvent) -> Vec<RunEvent> {
    normalize_process_event(event, |line| parse_bob_line(line))
}

/// Port of the TS `parseBobStreamLine`. bob emits one JSON object
/// per line in stream-json mode; this decodes the fields we care
/// about (assistant text, suggested edits, tool/file activity).
///
/// Kept behaviourally identical to the TS original so the live
/// rewire is a no-op for users: a non-JSON line passes through as
/// raw text, text comes from `text` / `delta` / `content`, edits
/// from the record itself or `edits` / `suggestedEdits` /
/// `suggestions` arrays, and `type`-tagged tool/file events become
/// activity strings.
pub fn parse_bob_line(line: &str) -> ParsedLine {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return ParsedLine::default();
    }

    let payload: Value = match serde_json::from_str(trimmed) {
        Ok(value) => value,
        // Not JSON — bob occasionally prints prose. Pass the raw
        // (untrimmed) line through as text, matching the TS.
        Err(_) => {
            return ParsedLine {
                text: Some(line.to_owned()),
                ..ParsedLine::default()
            }
        }
    };

    let Some(record) = payload.as_object() else {
        return ParsedLine::default();
    };

    let edits = parse_suggested_edits(record);

    let text_candidate = pick_string(record, "text")
        .or_else(|| pick_string(record, "delta"))
        .or_else(|| pick_string(record, "content"));

    if let Some(text) = text_candidate {
        return ParsedLine {
            text: Some(text),
            thinking: None,
            edits,
            activity: None,
        };
    }

    if !edits.is_empty() {
        let n = edits.len();
        let activity = format!("{n} suggested edit{}", if n == 1 { "" } else { "s" });
        return ParsedLine {
            text: None,
            thinking: None,
            edits,
            activity: Some(activity),
        };
    }

    if let Some(type_str) = record.get("type").and_then(Value::as_str) {
        let lowered = type_str.to_lowercase();
        if lowered.contains("tool") {
            let target = pick_string(record, "name")
                .or_else(|| pick_string(record, "tool"))
                .or_else(|| pick_string(record, "path"))
                .or_else(|| pick_string(record, "file"));
            return ParsedLine {
                activity: Some(match target {
                    Some(t) => format!("Tool · {t}"),
                    None => "Tool activity".to_owned(),
                }),
                ..ParsedLine::default()
            };
        }
        if lowered.contains("file") || lowered.contains("edit") {
            let target =
                pick_string(record, "path").or_else(|| pick_string(record, "file"));
            return ParsedLine {
                activity: Some(match target {
                    Some(t) => format!("Editing {t}"),
                    None => "File edit".to_owned(),
                }),
                ..ParsedLine::default()
            };
        }
    }

    ParsedLine::default()
}

/// Non-empty string field, else `None` (mirrors TS `pickString`).
fn pick_string(record: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    match record.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// String field allowing empty (mirrors TS `pickStringValue` — used
/// for replacements, which may legitimately be the empty string for
/// a deletion).
fn pick_string_value(record: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    match record.get(key) {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

fn parse_suggested_edits(record: &serde_json::Map<String, Value>) -> Vec<SuggestedEdit> {
    let mut edits = Vec::new();
    if let Some(direct) = parse_suggested_edit(record) {
        edits.push(direct);
    }
    for key in ["edits", "suggestedEdits", "suggestions"] {
        let Some(Value::Array(items)) = record.get(key) else {
            continue;
        };
        for item in items {
            if let Some(obj) = item.as_object() {
                if let Some(parsed) = parse_suggested_edit(obj) {
                    edits.push(parsed);
                }
            }
        }
    }
    edits
}

fn parse_suggested_edit(record: &serde_json::Map<String, Value>) -> Option<SuggestedEdit> {
    let file_path = pick_string(record, "filePath")
        .or_else(|| pick_string(record, "path"))
        .or_else(|| pick_string(record, "file"))?;

    // Range may be nested under `range` or flat on the record.
    let range_record = match record.get("range").and_then(Value::as_object) {
        Some(nested) => nested,
        None => record,
    };
    let start = range_record.get("start").and_then(Value::as_u64)?;
    let end = range_record.get("end").and_then(Value::as_u64)?;

    let replacement = pick_string_value(record, "replacement")
        .or_else(|| pick_string_value(record, "replaceWith"))
        .or_else(|| pick_string_value(record, "insert"))
        .or_else(|| pick_string_value(record, "newText"))?;

    let title = pick_string(record, "title")
        .or_else(|| pick_string(record, "summary"))
        .or_else(|| pick_string(record, "description"));

    Some(SuggestedEdit {
        file_path,
        range: ByteRange { start, end },
        replacement,
        title,
    })
}

fn truncate(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_line_yields_nothing() {
        assert!(parse_bob_line("   ").is_empty());
    }

    #[test]
    fn non_json_passes_through_as_text() {
        let parsed = parse_bob_line("hello world");
        assert_eq!(parsed.text.as_deref(), Some("hello world"));
        assert!(parsed.edits.is_empty());
    }

    #[test]
    fn text_field_becomes_text() {
        let parsed = parse_bob_line(r#"{"type":"message","text":"hi there"}"#);
        assert_eq!(parsed.text.as_deref(), Some("hi there"));
        assert!(parsed.activity.is_none());
    }

    #[test]
    fn delta_and_content_are_text_fallbacks() {
        assert_eq!(parse_bob_line(r#"{"delta":"d"}"#).text.as_deref(), Some("d"));
        assert_eq!(
            parse_bob_line(r#"{"content":"c"}"#).text.as_deref(),
            Some("c")
        );
    }

    #[test]
    fn flat_suggested_edit_parses() {
        let line = r#"{"filePath":"notes/a.md","start":3,"end":7,"replacement":"X","title":"fix"}"#;
        let parsed = parse_bob_line(line);
        assert_eq!(parsed.edits.len(), 1);
        let edit = &parsed.edits[0];
        assert_eq!(edit.file_path, "notes/a.md");
        assert_eq!(edit.range, ByteRange { start: 3, end: 7 });
        assert_eq!(edit.replacement, "X");
        assert_eq!(edit.title.as_deref(), Some("fix"));
        // No text → activity reports the edit count.
        assert_eq!(parsed.activity.as_deref(), Some("1 suggested edit"));
    }

    #[test]
    fn nested_range_and_array_edits_parse() {
        let line = r#"{"edits":[{"path":"a.md","range":{"start":0,"end":1},"newText":""},
                                 {"file":"b.md","range":{"start":2,"end":4},"insert":"yo"}]}"#;
        let parsed = parse_bob_line(line);
        assert_eq!(parsed.edits.len(), 2);
        assert_eq!(parsed.edits[0].replacement, ""); // empty replacement = deletion, allowed
        assert_eq!(parsed.edits[1].replacement, "yo");
        assert_eq!(parsed.activity.as_deref(), Some("2 suggested edits"));
    }

    #[test]
    fn text_with_edits_keeps_both_and_no_activity() {
        let line = r#"{"text":"done","filePath":"a.md","start":0,"end":1,"replacement":"Z"}"#;
        let parsed = parse_bob_line(line);
        assert_eq!(parsed.text.as_deref(), Some("done"));
        assert_eq!(parsed.edits.len(), 1);
        assert!(parsed.activity.is_none());
    }

    #[test]
    fn tool_and_file_types_become_activity() {
        assert_eq!(
            parse_bob_line(r#"{"type":"tool_use","name":"grep"}"#)
                .activity
                .as_deref(),
            Some("Tool · grep")
        );
        assert_eq!(
            parse_bob_line(r#"{"type":"tool_use"}"#).activity.as_deref(),
            Some("Tool activity")
        );
        assert_eq!(
            parse_bob_line(r#"{"type":"file_edit","path":"notes/x.md"}"#)
                .activity
                .as_deref(),
            Some("Editing notes/x.md")
        );
    }

    #[test]
    fn incomplete_edit_is_ignored() {
        // Missing `end` → not a valid edit.
        let parsed = parse_bob_line(r#"{"filePath":"a.md","start":3,"replacement":"X"}"#);
        assert!(parsed.edits.is_empty());
    }

    #[test]
    fn normalize_stdout_text_event() {
        let events = normalize_bob_event(BobRunEvent::Stdout {
            run_id: "r1".to_owned(),
            line: r#"{"text":"hi"}"#.to_owned(),
        });
        assert_eq!(events.len(), 1);
        assert!(matches!(
            &events[0],
            RunEvent::Text { run_id, delta } if run_id == "r1" && delta == "hi"
        ));
    }

    #[test]
    fn normalize_passes_through_lifecycle_events() {
        assert!(matches!(
            normalize_bob_event(BobRunEvent::Started { run_id: "r".into() }).as_slice(),
            [RunEvent::Started { .. }]
        ));
        assert!(matches!(
            normalize_bob_event(BobRunEvent::Exited {
                run_id: "r".into(),
                exit_code: Some(0),
                cancelled: false
            })
            .as_slice(),
            [RunEvent::Exited { exit_code: Some(0), cancelled: false, .. }]
        ));
    }

    #[test]
    fn run_event_serializes_with_kind_and_camelcase() {
        let json = serde_json::to_value(RunEvent::Exited {
            run_id: "r1".to_owned(),
            exit_code: Some(2),
            cancelled: true,
        })
        .unwrap();
        assert_eq!(json["kind"], "exited");
        assert_eq!(json["runId"], "r1");
        assert_eq!(json["exitCode"], 2);
        assert_eq!(json["cancelled"], true);
    }

    #[test]
    fn suggested_edits_event_serializes_camelcase() {
        let json = serde_json::to_value(RunEvent::SuggestedEdits {
            run_id: "r1".to_owned(),
            edits: vec![SuggestedEdit {
                file_path: "a.md".to_owned(),
                range: ByteRange { start: 1, end: 2 },
                replacement: "x".to_owned(),
                title: None,
            }],
        })
        .unwrap();
        assert_eq!(json["kind"], "suggestedEdits");
        assert_eq!(json["edits"][0]["filePath"], "a.md");
        assert_eq!(json["edits"][0]["range"]["start"], 1);
        // title omitted when None
        assert!(json["edits"][0].get("title").is_none());
    }

    #[test]
    fn thinking_normalizes_and_serializes() {
        let events = normalize_process_event(
            BobRunEvent::Stdout {
                run_id: "r1".to_owned(),
                line: "ignored".to_owned(),
            },
            |_| ParsedLine {
                thinking: Some("pondering".to_owned()),
                ..ParsedLine::default()
            },
        );
        assert!(matches!(
            events.as_slice(),
            [RunEvent::Thinking { run_id, delta }] if run_id == "r1" && delta == "pondering"
        ));
        let json = serde_json::to_value(RunEvent::Thinking {
            run_id: "r1".to_owned(),
            delta: "d".to_owned(),
        })
        .unwrap();
        assert_eq!(json["kind"], "thinking");
        assert_eq!(json["runId"], "r1");
        assert_eq!(json["delta"], "d");
    }
}
