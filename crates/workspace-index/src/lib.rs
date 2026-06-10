//! Pure markdown workspace index + search core.
//!
//! This crate owns the *logic* of building a workspace index (parsing
//! headings, tags, frontmatter, and links into a snapshot) and searching
//! it. It deliberately has **no** Tauri, filesystem, or SQLite
//! dependency, so it compiles to both:
//!
//!   * **native** — consumed by `src-tauri`, which scans the real folder
//!     off disk, calls [`build_snapshot`], mirrors records into SQLite,
//!     and caches the snapshot; and
//!   * **WASM** — consumed by the browser via the `workspace-index-wasm`
//!     wrapper, which feeds in the virtual-workspace file contents.
//!
//! Both frontends run the *same* code over the same `{path, content}`
//! input, which is the whole point: one implementation, no TS-fallback
//! drift. This mirrors `bob-rs`'s "pure, reusable" discipline.
//!
//! Two inputs that depend on the host are passed *in* rather than
//! computed here, so the core stays clock-free and fs-free (and so it
//! never calls `SystemTime::now()`, which panics on `wasm32`):
//! `duration_ms` and `indexed_at_ms`. Likewise `content_hash` is the
//! caller's choice — native uses the SHA-256 the rest of the app uses;
//! [`IndexedDocument::from_content`] supplies a cheap stable hash for
//! callers that don't care.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

/// A half-open `[start, end)` UTF-8 byte range into a document's source.
///
/// The single coordinate type shared across the index, comment, and
/// search wire formats. Persisted positions are always byte offsets.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceRange {
    pub start: i64,
    pub end: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexSnapshot {
    pub backlinks: Vec<BacklinkRecord>,
    pub documents: Vec<IndexedDocument>,
    pub duration_ms: u128,
    pub frontmatter: Vec<FrontmatterRecord>,
    pub graph_edges: Vec<GraphEdgeRecord>,
    pub indexed_at_ms: i64,
    pub indexed_document_count: usize,
    pub tags: Vec<TagRecord>,
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexedDocument {
    pub content_hash: String,
    pub doc_id: String,
    pub path: String,
    pub title: String,
    #[serde(skip_serializing)]
    content: String,
}

impl IndexedDocument {
    /// Construct from fully-resolved fields. The native command uses this
    /// with the app's SHA-256 `content_hash` and its own title logic, so
    /// the desktop snapshot is byte-for-byte what it was before.
    pub fn new(
        doc_id: String,
        path: String,
        title: String,
        content_hash: String,
        content: String,
    ) -> Self {
        Self {
            content_hash,
            doc_id,
            path,
            title,
            content,
        }
    }

    /// Convenience for callers (the WASM wrapper) that just have
    /// `{doc_id, path, content}`: derives the title from the first
    /// heading (then the path stem) and a cheap stable content hash.
    pub fn from_content(doc_id: String, path: String, content: String) -> Self {
        let title = title_from_markdown(&content)
            .or_else(|| title_from_path(&path))
            .unwrap_or_else(|| path.clone());
        let content_hash = hash_content(&content);
        Self {
            content_hash,
            doc_id,
            path,
            title,
            content,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkRecord {
    pub kind: LinkKind,
    pub label: String,
    pub source_doc_id: String,
    pub source_path: String,
    pub source_range: SourceRange,
    pub target_doc_id: Option<String>,
    pub target_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdgeRecord {
    pub from_doc_id: String,
    pub from_path: String,
    pub kind: LinkKind,
    pub source_range: SourceRange,
    pub to_doc_id: Option<String>,
    pub to_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagRecord {
    pub doc_id: String,
    pub kind: TagKind,
    pub path: String,
    pub source_range: SourceRange,
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FrontmatterRecord {
    pub doc_id: String,
    pub key: String,
    pub path: String,
    pub source_range: SourceRange,
    pub value: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LinkKind {
    Markdown,
    Wikilink,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TagKind {
    Frontmatter,
    Inline,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub doc_id: String,
    pub path: String,
    pub ranges: Vec<SourceRange>,
    pub score: f32,
    pub snippet: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MarkdownLink {
    kind: LinkKind,
    label: String,
    range: SourceRange,
    target_path: String,
}

/// A parsed frontmatter field: `(key, value, byte range of the value)`.
type FrontmatterField = (String, String, SourceRange);
/// A parsed tag: `(tag text, kind, byte range)`.
type ParsedTag = (String, TagKind, SourceRange);

struct DocumentParseResult {
    frontmatter: Vec<FrontmatterField>,
    links: Vec<MarkdownLink>,
    tags: Vec<ParsedTag>,
}

/// Build a workspace index snapshot from already-loaded documents.
///
/// `duration_ms` and `indexed_at_ms` are supplied by the host (the core
/// has no clock) so this stays deterministic and `wasm32`-safe.
pub fn build_snapshot(
    workspace_id: String,
    documents: Vec<IndexedDocument>,
    duration_ms: u128,
    indexed_at_ms: i64,
) -> WorkspaceIndexSnapshot {
    let doc_id_by_path: HashMap<_, _> = documents
        .iter()
        .map(|document| (document.path.clone(), document.doc_id.clone()))
        .collect();
    let mut backlinks = Vec::new();
    let mut frontmatter = Vec::new();
    let mut graph_edges = Vec::new();
    let mut tags = Vec::new();

    for document in &documents {
        let parsed = parse_markdown_document(&document.path, &document.content, &doc_id_by_path);
        for (key, value, source_range) in parsed.frontmatter {
            frontmatter.push(FrontmatterRecord {
                doc_id: document.doc_id.clone(),
                key,
                path: document.path.clone(),
                source_range,
                value,
            });
        }
        for (tag, kind, source_range) in parsed.tags {
            tags.push(TagRecord {
                doc_id: document.doc_id.clone(),
                kind,
                path: document.path.clone(),
                source_range,
                tag,
            });
        }
        for link in parsed.links {
            let target_doc_id = doc_id_by_path.get(&link.target_path).cloned();
            backlinks.push(BacklinkRecord {
                kind: link.kind,
                label: link.label.clone(),
                source_doc_id: document.doc_id.clone(),
                source_path: document.path.clone(),
                source_range: link.range.clone(),
                target_doc_id: target_doc_id.clone(),
                target_path: link.target_path.clone(),
            });
            graph_edges.push(GraphEdgeRecord {
                from_doc_id: document.doc_id.clone(),
                from_path: document.path.clone(),
                kind: link.kind,
                source_range: link.range,
                to_doc_id: target_doc_id,
                to_path: link.target_path,
            });
        }
    }

    backlinks.sort_by(|a, b| {
        a.target_path
            .cmp(&b.target_path)
            .then_with(|| a.source_path.cmp(&b.source_path))
            .then_with(|| a.source_range.start.cmp(&b.source_range.start))
    });
    frontmatter.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then_with(|| a.key.cmp(&b.key))
            .then_with(|| a.source_range.start.cmp(&b.source_range.start))
    });
    graph_edges.sort_by(|a, b| {
        a.from_path
            .cmp(&b.from_path)
            .then_with(|| a.to_path.cmp(&b.to_path))
            .then_with(|| a.source_range.start.cmp(&b.source_range.start))
    });
    tags.sort_by(|a, b| {
        a.tag
            .cmp(&b.tag)
            .then_with(|| a.path.cmp(&b.path))
            .then_with(|| a.source_range.start.cmp(&b.source_range.start))
    });

    WorkspaceIndexSnapshot {
        backlinks,
        indexed_document_count: documents.len(),
        documents,
        duration_ms,
        frontmatter,
        graph_edges,
        indexed_at_ms,
        tags,
        workspace_id,
    }
}

/// Search a snapshot for `query`, returning up to `limit` ranked hits.
pub fn search_snapshot(
    snapshot: &WorkspaceIndexSnapshot,
    query: &str,
    limit: usize,
) -> Vec<SearchHit> {
    let query = query.trim();
    if query.is_empty() || limit == 0 {
        return Vec::new();
    }
    let terms = query_terms(query);
    let mut hits = Vec::new();

    for document in &snapshot.documents {
        let ranges = query_ranges(&document.content, query, &terms);
        let path_match = ascii_contains(&document.path, query);
        let title_match = ascii_contains(&document.title, query);
        if ranges.is_empty() && !path_match && !title_match {
            continue;
        }
        let mut score = (ranges.len() as f32) * 10.0;
        if title_match {
            score += 6.0;
        }
        if path_match {
            score += 3.0;
        }
        hits.push(SearchHit {
            doc_id: document.doc_id.clone(),
            path: document.path.clone(),
            ranges: ranges.clone(),
            score,
            snippet: snippet_for(&document.content, ranges.first()),
            title: document.title.clone(),
        });
    }

    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.path.cmp(&b.path))
    });
    hits.truncate(limit);
    hits
}

/// First Markdown heading text, if the document opens with one.
pub fn title_from_markdown(content: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let trimmed = line.trim_start();
        if !trimmed.starts_with('#') {
            return None;
        }
        let heading_marks = trimmed.chars().take_while(|ch| *ch == '#').count();
        if !(1..=6).contains(&heading_marks) {
            return None;
        }
        let title = trimmed[heading_marks..].trim();
        (!title.is_empty()).then(|| title.to_owned())
    })
}

/// Title fallback: the file stem of a relative path.
pub fn title_from_path(relative_path: &str) -> Option<String> {
    Path::new(relative_path)
        .file_stem()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_owned)
}

// ---- Parsing ---------------------------------------------------------------

fn parse_markdown_document(
    source_path: &str,
    content: &str,
    doc_id_by_path: &HashMap<String, String>,
) -> DocumentParseResult {
    let (frontmatter, frontmatter_tags, frontmatter_end) = parse_frontmatter(content);
    let mut tags = frontmatter_tags;
    tags.extend(parse_inline_tags(content, frontmatter_end));

    let mut links = parse_wikilinks(source_path, content, doc_id_by_path);
    links.extend(parse_markdown_links(source_path, content, doc_id_by_path));
    links.sort_by_key(|a| a.range.start);

    DocumentParseResult {
        frontmatter,
        links,
        tags,
    }
}

fn parse_frontmatter(content: &str) -> (Vec<FrontmatterField>, Vec<ParsedTag>, usize) {
    let Some(first_line_end) = content.find('\n') else {
        return (Vec::new(), Vec::new(), 0);
    };
    if content[..first_line_end].trim_end_matches('\r') != "---" {
        return (Vec::new(), Vec::new(), 0);
    }

    let mut fields = Vec::new();
    let mut tags = Vec::new();
    let mut in_tags_list = false;
    let mut offset = first_line_end + 1;
    while offset < content.len() {
        let next_line_end = content[offset..]
            .find('\n')
            .map(|relative| offset + relative + 1)
            .unwrap_or(content.len());
        let line = &content[offset..next_line_end];
        let line_without_newline = line.trim_end_matches(['\r', '\n']);
        let trimmed = line_without_newline.trim();
        if trimmed == "---" || trimmed == "..." {
            return (fields, tags, next_line_end);
        }

        let leading = line_without_newline.len() - line_without_newline.trim_start().len();
        let trimmed_start = line_without_newline.trim_start();
        if in_tags_list && trimmed_start.starts_with("- ") {
            let value_offset = offset + leading + 2;
            let value = trimmed_start[2..].trim();
            tags.extend(tags_from_frontmatter_value(
                value,
                byte_range(value_offset, value),
            ));
            offset = next_line_end;
            continue;
        }

        in_tags_list = false;
        if let Some(colon_index) = trimmed_start.find(':') {
            let key = trimmed_start[..colon_index].trim();
            let value = trimmed_start[colon_index + 1..].trim();
            if !key.is_empty() {
                let range = byte_range(offset + leading, trimmed_start.trim_end());
                fields.push((key.to_owned(), value.to_owned(), range.clone()));
                if key.eq_ignore_ascii_case("tags") {
                    if value.is_empty() {
                        in_tags_list = true;
                    } else {
                        let value_offset = offset
                            + leading
                            + colon_index
                            + 1
                            + leading_trim_count(&trimmed_start[colon_index + 1..]);
                        tags.extend(tags_from_frontmatter_value(
                            value,
                            byte_range(value_offset, value),
                        ));
                    }
                }
            }
        }
        offset = next_line_end;
    }

    (Vec::new(), Vec::new(), 0)
}

fn tags_from_frontmatter_value(
    value: &str,
    source_range: SourceRange,
) -> Vec<(String, TagKind, SourceRange)> {
    value
        .trim_matches(|ch| ch == '[' || ch == ']')
        .split([',', ' '])
        .map(|item| {
            item.trim()
                .trim_matches(|ch| ch == '"' || ch == '\'' || ch == '#')
        })
        .filter(|item| !item.is_empty())
        .map(|item| {
            (
                normalize_tag(item),
                TagKind::Frontmatter,
                source_range.clone(),
            )
        })
        .collect()
}

fn parse_inline_tags(content: &str, start_offset: usize) -> Vec<ParsedTag> {
    let mut tags = Vec::new();
    let mut index = start_offset;
    while index < content.len() {
        let Some(relative) = content[index..].find('#') else {
            break;
        };
        let hash = index + relative;
        let after_hash = hash + 1;
        if after_hash >= content.len() {
            break;
        }
        if is_heading_marker(content, hash) || is_embedded_in_word(content, hash) {
            index = after_hash;
            continue;
        }
        let mut end = after_hash;
        for (relative_index, ch) in content[after_hash..].char_indices() {
            if !is_tag_char(ch) {
                break;
            }
            end = after_hash + relative_index + ch.len_utf8();
        }
        if end > after_hash {
            let tag = normalize_tag(&content[after_hash..end]);
            tags.push((
                tag,
                TagKind::Inline,
                SourceRange {
                    start: hash as i64,
                    end: end as i64,
                },
            ));
        }
        index = end.max(after_hash);
    }
    tags
}

fn parse_wikilinks(
    source_path: &str,
    content: &str,
    doc_id_by_path: &HashMap<String, String>,
) -> Vec<MarkdownLink> {
    let mut links = Vec::new();
    let mut index = 0;
    while index < content.len() {
        let Some(relative_start) = content[index..].find("[[") else {
            break;
        };
        let start = index + relative_start;
        let body_start = start + 2;
        let Some(relative_end) = content[body_start..].find("]]") else {
            break;
        };
        let body_end = body_start + relative_end;
        let body = &content[body_start..body_end];
        let (target, label) = wikilink_target_and_label(body);
        if !target.is_empty() {
            links.push(MarkdownLink {
                kind: LinkKind::Wikilink,
                label: label.to_owned(),
                range: SourceRange {
                    start: start as i64,
                    end: (body_end + 2) as i64,
                },
                target_path: resolve_document_target(source_path, target, doc_id_by_path),
            });
        }
        index = body_end + 2;
    }
    links
}

fn parse_markdown_links(
    source_path: &str,
    content: &str,
    doc_id_by_path: &HashMap<String, String>,
) -> Vec<MarkdownLink> {
    let mut links = Vec::new();
    let mut index = 0;
    while index < content.len() {
        let Some(close_label_relative) = content[index..].find("](") else {
            break;
        };
        let close_label = index + close_label_relative;
        let Some(open_label) = content[..close_label].rfind('[') else {
            index = close_label + 2;
            continue;
        };
        if open_label > 0 && content.as_bytes()[open_label - 1] == b'!' {
            index = close_label + 2;
            continue;
        }
        let target_start = close_label + 2;
        let Some(target_end_relative) = content[target_start..].find(')') else {
            break;
        };
        let target_end = target_start + target_end_relative;
        let raw_target = content[target_start..target_end].trim();
        if should_index_markdown_target(raw_target) {
            let label = content[open_label + 1..close_label].trim();
            links.push(MarkdownLink {
                kind: LinkKind::Markdown,
                label: if label.is_empty() { raw_target } else { label }.to_owned(),
                range: SourceRange {
                    start: open_label as i64,
                    end: (target_end + 1) as i64,
                },
                target_path: resolve_document_target(source_path, raw_target, doc_id_by_path),
            });
        }
        index = target_end + 1;
    }
    links
}

// ---- Search helpers --------------------------------------------------------

fn query_terms(query: &str) -> Vec<&str> {
    query
        .split(|ch: char| !ch.is_alphanumeric() && ch != '_' && ch != '-')
        .filter(|term| !term.is_empty())
        .collect()
}

fn query_ranges(content: &str, query: &str, terms: &[&str]) -> Vec<SourceRange> {
    let mut ranges = exact_ranges(content, query, 6);
    if ranges.is_empty() {
        for term in terms {
            for range in exact_ranges(content, term, 3) {
                if ranges.len() >= 6 {
                    break;
                }
                if !ranges.iter().any(|existing| existing == &range) {
                    ranges.push(range);
                }
            }
        }
    }
    if ranges.is_empty() && query.is_ascii() {
        ranges = ascii_case_insensitive_ranges(content, query, 6);
    }
    ranges
}

fn exact_ranges(content: &str, needle: &str, limit: usize) -> Vec<SourceRange> {
    if needle.is_empty() {
        return Vec::new();
    }
    let mut ranges = Vec::new();
    let mut offset = 0;
    while offset < content.len() && ranges.len() < limit {
        let Some(relative) = content[offset..].find(needle) else {
            break;
        };
        let start = offset + relative;
        let end = start + needle.len();
        ranges.push(SourceRange {
            start: start as i64,
            end: end as i64,
        });
        offset = end;
    }
    ranges
}

fn ascii_case_insensitive_ranges(content: &str, needle: &str, limit: usize) -> Vec<SourceRange> {
    if needle.is_empty() || !needle.is_ascii() {
        return Vec::new();
    }
    let haystack = content.to_ascii_lowercase();
    let needle = needle.to_ascii_lowercase();
    exact_ranges(&haystack, &needle, limit)
}

fn snippet_for(content: &str, first_range: Option<&SourceRange>) -> String {
    let Some(range) = first_range else {
        return content
            .lines()
            .next()
            .unwrap_or("")
            .chars()
            .take(120)
            .collect();
    };
    let start = previous_char_boundary(content, (range.start as usize).saturating_sub(48));
    let end = next_char_boundary(content, ((range.end as usize) + 96).min(content.len()));
    let mut snippet = String::new();
    if start > 0 {
        snippet.push('…');
    }
    snippet.push_str(content[start..end].trim());
    if end < content.len() {
        snippet.push('…');
    }
    snippet.replace('\n', " ")
}

// ---- Link resolution -------------------------------------------------------

fn wikilink_target_and_label(body: &str) -> (&str, &str) {
    let mut parts = body.splitn(2, '|');
    let target = parts.next().unwrap_or("").trim();
    let label = parts.next().unwrap_or(target).trim();
    (target, if label.is_empty() { target } else { label })
}

fn should_index_markdown_target(target: &str) -> bool {
    if target.is_empty() || target.starts_with('#') {
        return false;
    }
    if target.contains("://") || target.starts_with("mailto:") {
        return false;
    }
    let without_fragment = target.split('#').next().unwrap_or(target);
    without_fragment.ends_with(".md") || !without_fragment.contains('.')
}

fn resolve_document_target(
    source_path: &str,
    raw_target: &str,
    doc_id_by_path: &HashMap<String, String>,
) -> String {
    let target = raw_target
        .split('#')
        .next()
        .unwrap_or(raw_target)
        .trim()
        .replace('\\', "/");
    if target.is_empty() {
        return target;
    }

    let mut candidates = Vec::new();
    let with_extension = if target.ends_with(".md") {
        target.clone()
    } else {
        format!("{target}.md")
    };

    if target.contains('/') || target.starts_with('.') {
        let source_parent = Path::new(source_path)
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default();
        candidates.push(normalize_path(source_parent.join(&with_extension)));
        candidates.push(normalize_path(PathBuf::from(&with_extension)));
    } else {
        candidates.push(with_extension.clone());
        candidates.extend(
            doc_id_by_path
                .keys()
                .filter(|path| path_stem_matches(path, &target))
                .cloned(),
        );
    }

    candidates
        .iter()
        .find(|candidate| doc_id_by_path.contains_key(*candidate))
        .cloned()
        .unwrap_or_else(|| candidates.first().cloned().unwrap_or(with_extension))
}

fn path_stem_matches(path: &str, target: &str) -> bool {
    let path_without_extension = path.strip_suffix(".md").unwrap_or(path);
    let basename = path_without_extension
        .rsplit('/')
        .next()
        .unwrap_or(path_without_extension);
    path_without_extension.eq_ignore_ascii_case(target)
        || basename.eq_ignore_ascii_case(target)
        || slug_key(path_without_extension) == slug_key(target)
        || slug_key(basename) == slug_key(target)
}

fn slug_key(value: &str) -> String {
    value
        .chars()
        .filter_map(|ch| {
            if ch.is_alphanumeric() {
                Some(ch.to_ascii_lowercase())
            } else if matches!(ch, ' ' | '-' | '_' | '/') {
                Some('-')
            } else {
                None
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn normalize_path(path: PathBuf) -> String {
    let mut segments: Vec<String> = Vec::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                segments.pop();
            }
            Component::Normal(value) => segments.push(value.to_string_lossy().to_string()),
            Component::CurDir => {}
            _ => {}
        }
    }
    segments.join("/")
}

// ---- Small pure helpers ----------------------------------------------------

fn is_heading_marker(content: &str, hash_index: usize) -> bool {
    let line_start = content[..hash_index]
        .rfind('\n')
        .map(|index| index + 1)
        .unwrap_or(0);
    content[line_start..hash_index].trim().is_empty()
        && content[hash_index..].starts_with('#')
        && content[hash_index..]
            .chars()
            .nth(1)
            .map(|ch| ch == ' ' || ch == '#')
            .unwrap_or(false)
}

fn is_embedded_in_word(content: &str, hash_index: usize) -> bool {
    content[..hash_index]
        .chars()
        .next_back()
        .map(|ch| ch.is_alphanumeric() || ch == '_' || ch == '-')
        .unwrap_or(false)
}

fn is_tag_char(ch: char) -> bool {
    ch.is_alphanumeric() || matches!(ch, '_' | '-' | '/')
}

fn normalize_tag(tag: &str) -> String {
    tag.trim().trim_start_matches('#').to_owned()
}

fn ascii_contains(haystack: &str, needle: &str) -> bool {
    haystack
        .to_ascii_lowercase()
        .contains(&needle.to_ascii_lowercase())
}

fn byte_range(start: usize, value: &str) -> SourceRange {
    SourceRange {
        start: start as i64,
        end: (start + value.len()) as i64,
    }
}

fn leading_trim_count(value: &str) -> usize {
    value.len() - value.trim_start().len()
}

fn previous_char_boundary(content: &str, mut index: usize) -> usize {
    while index > 0 && !content.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn next_char_boundary(content: &str, mut index: usize) -> usize {
    while index < content.len() && !content.is_char_boundary(index) {
        index += 1;
    }
    index
}

/// Cheap, stable, dependency-free FNV-1a hash for the convenience
/// [`IndexedDocument::from_content`] constructor. Not cryptographic —
/// the native path uses the app's SHA-256 instead.
fn hash_content(content: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in content.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc_map(paths: &[(&str, &str)]) -> HashMap<String, String> {
        paths
            .iter()
            .map(|(path, doc_id)| ((*path).to_owned(), (*doc_id).to_owned()))
            .collect()
    }

    fn document(path: &str, doc_id: &str, content: &str) -> IndexedDocument {
        IndexedDocument::from_content(doc_id.to_owned(), path.to_owned(), content.to_owned())
    }

    #[test]
    fn search_hits_return_utf8_byte_ranges() {
        let snapshot = build_snapshot(
            "workspace-1".to_owned(),
            vec![document(
                "notes/cafe.md",
                "doc-1",
                "# Café\n\nRésumé notes for Café Bob.",
            )],
            3,
            0,
        );

        let hits = search_snapshot(&snapshot, "Résumé", 10);

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].ranges, vec![SourceRange { start: 9, end: 17 }]);
        assert!(hits[0].snippet.contains("Résumé notes"));
    }

    #[test]
    fn wikilinks_resolve_to_existing_documents_and_create_graph_edges() {
        let snapshot = build_snapshot(
            "workspace-1".to_owned(),
            vec![
                document(
                    "notes/source.md",
                    "doc-source",
                    "See [[Target note|target]] next.",
                ),
                document("research/target-note.md", "doc-target", "# Target note"),
            ],
            2,
            0,
        );

        assert_eq!(snapshot.backlinks.len(), 1);
        assert_eq!(
            snapshot.backlinks[0].target_doc_id.as_deref(),
            Some("doc-target")
        );
        assert_eq!(snapshot.backlinks[0].target_path, "research/target-note.md");
        assert_eq!(snapshot.graph_edges[0].kind, LinkKind::Wikilink);
    }

    #[test]
    fn markdown_links_resolve_relative_paths() {
        let paths = doc_map(&[
            ("notes/source.md", "doc-source"),
            ("research/target.md", "doc-target"),
        ]);
        let links = parse_markdown_links(
            "notes/source.md",
            "Read [target](../research/target.md).",
            &paths,
        );

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target_path, "research/target.md");
        assert_eq!(links[0].range, SourceRange { start: 5, end: 36 });
    }

    #[test]
    fn tags_and_frontmatter_are_indexed_with_source_ranges() {
        let content = "---\ntags: [alpha, beta]\nowner: Bob\n---\n# Note\n\nBody #gamma and a heading below.\n## Not a tag\n";
        let snapshot = build_snapshot(
            "workspace-1".to_owned(),
            vec![document("note.md", "doc-1", content)],
            1,
            0,
        );

        assert_eq!(
            snapshot
                .tags
                .iter()
                .map(|tag| (&tag.tag, tag.kind))
                .collect::<Vec<_>>(),
            vec![
                (&"alpha".to_owned(), TagKind::Frontmatter),
                (&"beta".to_owned(), TagKind::Frontmatter),
                (&"gamma".to_owned(), TagKind::Inline),
            ],
        );
        assert_eq!(snapshot.frontmatter.len(), 2);
        assert_eq!(snapshot.frontmatter[0].key, "owner");
        assert_eq!(
            snapshot.frontmatter[0].source_range,
            SourceRange { start: 24, end: 34 }
        );
    }

    #[test]
    fn unresolved_links_keep_target_path_for_future_backlinks() {
        let paths = doc_map(&[("notes/source.md", "doc-source")]);
        let links = parse_wikilinks("notes/source.md", "See [[Missing Note]].", &paths);

        assert_eq!(links[0].target_path, "Missing Note.md");
    }
}
