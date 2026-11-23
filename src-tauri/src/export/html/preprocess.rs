//! Text passes over the note before it is rendered: wikilinks become links
//! and mermaid fences get a tag the renderer knows, never inside code.

use std::collections::HashMap;

use super::super::mermaid::MERMAID_LANG;
use super::comrak_options;

/// Where a document must NOT be rewritten by the text pre-passes, derived from
/// comrak's own parse — the same parser and options the render uses, so the
/// pre-passes can never disagree with the renderer about what is code. Block
/// protection covers code blocks (fenced at ANY container depth, and
/// indented), HTML blocks, and front matter; inline protection covers `code`
/// spans within otherwise-rewritable lines. Also collects the openers of
/// mermaid fences whose language tag needs case normalization.
pub(super) struct ProtectedRegions {
    /// `true` at index `line - 1` ⇒ the whole line is untouchable.
    block_lines: Vec<bool>,
    /// Per line: byte ranges (0-based, half-open) of inline code spans.
    inline_spans: HashMap<usize, Vec<(usize, usize)>>,
    /// Opener lines of fenced code blocks whose info's first token is
    /// `mermaid` in a non-lowercase casing.
    mermaid_openers: Vec<usize>,
}

pub(super) fn protected_regions(markdown: &str) -> ProtectedRegions {
    let line_count = markdown.split('\n').count();
    let mut regions = ProtectedRegions {
        block_lines: vec![false; line_count],
        inline_spans: HashMap::new(),
        mermaid_openers: Vec::new(),
    };
    let protect_lines = |from: usize, to: usize, regions: &mut ProtectedRegions| {
        for line in from..=to.min(line_count) {
            if line >= 1 {
                regions.block_lines[line - 1] = true;
            }
        }
    };

    let arena = comrak::Arena::new();
    let root = comrak::parse_document(&arena, markdown, &comrak_options());
    for node in root.descendants() {
        let data = node.data.borrow();
        let pos = data.sourcepos;
        match &data.value {
            comrak::nodes::NodeValue::CodeBlock(code) => {
                protect_lines(pos.start.line, pos.end.line, &mut regions);
                if code.fenced {
                    let token = code.info.split_whitespace().next().unwrap_or("");
                    if token.eq_ignore_ascii_case(MERMAID_LANG) && token != MERMAID_LANG {
                        regions.mermaid_openers.push(pos.start.line);
                    }
                }
            }
            comrak::nodes::NodeValue::HtmlBlock(_) | comrak::nodes::NodeValue::FrontMatter(_) => {
                protect_lines(pos.start.line, pos.end.line, &mut regions);
            }
            comrak::nodes::NodeValue::Code(_) => {
                if pos.start.line == pos.end.line {
                    // comrak columns are 1-based UTF-8 bytes; store 0-based
                    // half-open so the wikilink scanner can compare directly.
                    regions
                        .inline_spans
                        .entry(pos.start.line)
                        .or_default()
                        .push((pos.start.column - 1, pos.end.column));
                } else {
                    protect_lines(pos.start.line, pos.end.line, &mut regions);
                }
            }
            _ => {}
        }
    }
    regions
}

/// The single markdown pre-pass: convert wikilinks in prose (so the export
/// renders them as links) and lowercase case-varied `mermaid` language tags
/// (comrak dispatches per-language renderers on the VERBATIM token, while the
/// editor matches case-insensitively). Lines comrak parses as code — fenced at
/// any nesting depth, indented, inline spans — pass through verbatim, so a
/// documented `[[…]]` or a fence inside a list item stays literal.
pub(super) fn preprocess_markdown(markdown: &str) -> String {
    let regions = protected_regions(markdown);
    let mut out = String::with_capacity(markdown.len());
    for (index, line) in markdown.split_inclusive('\n').enumerate() {
        let line_no = index + 1;
        if regions.mermaid_openers.contains(&line_no) {
            normalize_mermaid_opener_line(line, &mut out);
        } else if regions.block_lines.get(index).copied().unwrap_or(false) {
            out.push_str(line);
        } else {
            let masked = regions.inline_spans.get(&line_no).map(Vec::as_slice).unwrap_or(&[]);
            convert_wikilinks_in_line(line, masked, &mut out);
        }
    }
    out
}

/// Rewrite one fence-opener line's language token to lowercase `mermaid`.
/// comrak already classified the line as a fenced-code opener with a
/// mermaid-cased first token, so the shape is fixed: indentation and/or
/// container prefix, a run of `` ` ``/`~`, optional spaces, then the token.
pub(super) fn normalize_mermaid_opener_line(line: &str, out: &mut String) {
    let Some(marks) = line.find(['`', '~']) else {
        out.push_str(line);
        return;
    };
    let fence_char = line.as_bytes()[marks];
    let after_marks =
        marks + line[marks..].bytes().take_while(|&b| b == fence_char).count();
    let token_start = after_marks
        + line[after_marks..]
            .find(|c: char| !c.is_whitespace())
            .unwrap_or(line.len() - after_marks);
    let token_end = token_start
        + line[token_start..]
            .find(char::is_whitespace)
            .unwrap_or(line.len() - token_start);
    if line[token_start..token_end].eq_ignore_ascii_case(MERMAID_LANG) {
        out.push_str(&line[..token_start]);
        out.push_str(MERMAID_LANG);
        out.push_str(&line[token_end..]);
    } else {
        out.push_str(line);
    }
}

/// Convert wikilinks in one prose line, leaving `[[…]]` inside the given
/// inline-code byte ranges literal.
pub(super) fn convert_wikilinks_in_line(line: &str, code_spans: &[(usize, usize)], out: &mut String) {
    let in_code = |offset: usize| code_spans.iter().any(|&(from, to)| offset >= from && offset < to);
    let mut cursor = 0usize;
    while let Some(found) = line[cursor..].find("[[") {
        let start = cursor + found;
        // Literal when the opener sits in a code span, or when the only
        // closing `]]` does — a wikilink never spans a code boundary.
        let closer_in_code =
            line[start + 2..].find("]]").map(|e| in_code(start + 2 + e)).unwrap_or(false);
        if in_code(start) || closer_in_code {
            out.push_str(&line[cursor..start + 2]);
            cursor = start + 2;
            continue;
        }
        convert_one_wikilink(line, start, &mut cursor, out);
    }
    out.push_str(&line[cursor..]);
}

/// Emit the text before `start`, then either a converted `[label](<href>)` or
/// the literal `[[` when no closing `]]` / target exists; advances `cursor`.
pub(super) fn convert_one_wikilink(line: &str, start: usize, cursor: &mut usize, out: &mut String) {
    out.push_str(&line[*cursor..start]);
    let literal = |cursor: &mut usize, out: &mut String| {
        out.push_str("[[");
        *cursor = start + 2;
    };
    let after_open = &line[start + 2..];
    let Some(end) = after_open.find("]]") else {
        return literal(cursor, out);
    };
    let (target, label) = wikilink_target_and_label(&after_open[..end]);
    if target.is_empty() {
        return literal(cursor, out);
    }
    // `[label](<href>)` — angle brackets allow spaces in the destination.
    out.push('[');
    out.push_str(label);
    out.push_str("](<");
    out.push_str(&wikilink_href(target));
    out.push_str(">)");
    *cursor = start + 2 + end + 2;
}

/// Mirror of the index crate's `wikilink_target_and_label`.
pub(super) fn wikilink_target_and_label(body: &str) -> (&str, &str) {
    let mut parts = body.splitn(2, '|');
    let target = parts.next().unwrap_or("").trim();
    let label = parts.next().map(str::trim).filter(|l| !l.is_empty()).unwrap_or(target);
    (target, label)
}

/// Best-effort href for a wikilink target: strip any `#anchor`, and give it
/// `.md` unless it already names a Markdown extension.
pub(super) fn wikilink_href(target: &str) -> String {
    let base = target.split('#').next().unwrap_or(target).trim().replace('\\', "/");
    if workspace_index::is_markdown_path(&base) {
        base
    } else {
        format!("{base}.md")
    }
}
