# Vellum Local-First Production Architecture Specification

**Working codename:** Vellum  
**Status:** v3.2 production architecture draft  
**Scope:** Local-first, source-preserving Markdown editor with custom rendering, Obsidian-style Live Preview, local comments, LLM context workflows, app-managed metadata storage, deterministic anchor transforms, incremental semantic maps, and future-safe collaboration seams.  
**Supersedes:** `vellum-local-first-production-spec-v3.1.md`.

---

## 0. What changed from v3.1

v3.2 locks the storage direction based on the current product decision:

```txt
No app metadata inside the Markdown vault.
No `.vellum/` folder inside the vault.
No `.vellum.sqlite` file inside the vault.
No `.bobapp/` folder inside the vault.
No portable live-metadata mode in v1.
```

v3.1 already tightened the production-critical editor core:

```txt
1. Coordinate discipline is explicit.
   Byte offsets are the only persisted source coordinate. Grapheme positions are transient.

2. Anchor transforms are specified as deterministic tables.
   No more prose like “expand or keep according to policy” without a model.

3. Semantic mapping is incremental and block-stable.
   The editor must not rebuild the whole semantic map on every keystroke.

4. Stable block identity is a contract.
   Structural anchors depend on it, so the semantic map must guarantee it.

5. Focus/input ownership is modeled.
   Canvas, hidden input, comments UI, command palette, and chat panels cannot all own selection.

6. Debug DOM and snapshot renderers are promoted to test infrastructure.
   They are not decorative future ideas.

7. Local history uses inverse patches as the primary store.
   Snapshots are checkpoints for fast seeking and recovery.

8. Milestones are reordered around the two highest-risk seams:
   Live Preview rendering and comment-anchor survival.
```

The product stance remains local-first, but the storage contract is now stricter: Markdown folders stay clean, while app metadata lives in app-owned SQLite outside the vault.

---

## 1. Product stance

Vellum is a **local-first Markdown editor with a source-preserving Live Preview layer**.

It is not primarily:

```txt
a canvas experiment
a CRDT experiment
a multiplayer editor
a rich-text editor
a cloud notes app
```

The first production version should feel like a serious local desktop tool:

```txt
fast open
fast typing
fast search
clean Obsidian-style Live Preview
safe local comments
comments that can seed LLM chats
no hidden project metadata files
```

The strategic moat is not “canvas.” The strategic moat is:

```txt
source-preserving Markdown editing
+ precise inline preview/source switching
+ local comments anchored to document ranges
+ AI workflows over exact document context
+ fast local indexing/search/backlinks
+ clean user-owned Markdown vaults
```

---

## 2. Non-negotiable invariants

### 2.1 Markdown files are canonical

The `.md` file is the user-owned durable artifact.

```txt
Markdown source on disk
  -> document kernel
  -> semantic map
  -> presentation plan
  -> renderer
```

Derived systems may cache, index, or annotate source. They cannot replace source.

### 2.2 Presentation is derived

Live Preview, hidden syntax, styled spans, widgets, layout, selection geometry, comment markers, and AI highlights are derived from:

```txt
source text
+ semantic map
+ active editor context
+ presentation rules
```

Presentation state may be cached, but it must be invalidatable and reproducible.

### 2.3 All source mutations go through typed transactions

Every source edit must pass through a transaction layer.

This is required for:

```txt
undo/redo
local history
comment anchor movement
external edit reconciliation
AI suggested edits
future collaboration
future sync
plugin commands
```

```rust
pub struct DocTransaction {
    pub id: TxId,
    pub doc_id: DocId,
    pub origin: TransactionOrigin,
    pub timestamp: Timestamp,
    pub base_revision: RevisionId,
    pub changes: Vec<TextChange>,
}

pub enum TransactionOrigin {
    UserTyping,
    Paste,
    MarkdownCommand,
    ExternalFileChange,
    AiSuggestedEditAccepted,
    PluginCommand(PluginId),
}
```

### 2.4 Document identity is not file path

File path is mutable. Document identity is stable.

```rust
pub struct VaultId(Uuid);
pub struct DocId(Uuid);
```

A document can move from:

```txt
research/idea.md
```

to:

```txt
writing/idea.md
```

without losing:

```txt
comments
LLM threads
local history
search index identity
backlink identity
AI suggestion history
```

### 2.5 Comments anchor to source-aware ranges

Comments do not attach to pixels, glyphs, rendered labels, or transient DOM nodes.

They attach to recoverable source ranges:

```txt
source range
+ semantic node path
+ selected text snapshot
+ prefix/suffix context
+ transaction mapping history
```

Future CRDT anchors can be added later, but v1 does not require CRDT.

### 2.6 App metadata is app-owned, not vault-owned

The user’s vault must not contain app-generated metadata files or folders.

```txt
Vault folder:
  user Markdown files
  user attachments
  user-created folders

Forbidden inside the vault:
  .vellum/
  .vellum.sqlite
  .bobapp/
  hidden app metadata folders
  hidden app metadata databases

App data directory:
  SQLite metadata
  comments
  local history
  LLM thread state
  indexes
  AI cache
  vault registry
```

This is not merely the default. It is the v1 storage contract.

### 2.7 Renderer is replaceable

The renderer consumes a presentation plan. It does not decide Markdown semantics.

```txt
semantic map
  -> presentation plan
  -> layout plan
  -> renderer backend
```

Canvas2D, GPU, Debug DOM, and Snapshot renderers should all consume the same plan.

---

## 3. Storage stance

### 3.1 Do not put app metadata in the vault

A hidden sidecar or metadata database inside the working folder creates practical problems:

```txt
non-technical users may delete it
sync tools may partially sync it
users may wonder whether it is safe
backups may include or exclude it unpredictably
external editors may expose it
project folders become polluted
```

V1 must not create workspace metadata automatically or optionally.

Forbidden operational metadata locations:

```txt
<workspace>/.vellum/
<workspace>/.vellum.sqlite
<workspace>/.bobapp/
<workspace>/.bobapp/metadata.sqlite
```

### 3.2 Store app-owned state in the OS app-data location

Default storage topology:

```txt
OS app data directory / Vellum /
  app.db
  vaults/
    <vault_id>/
      vault.db
      search-index/
      embeddings/
      snapshots/
      exports/
```

The app owns this area. Users should not need to touch it during normal use.

### 3.3 Use SQLite as durable metadata store

Use SQLite for:

```txt
vault registry
document identity
path history
comments
comment messages
LLM threads
LLM context packets
AI suggestions
local history metadata
anchor recovery metadata
settings
recent files
index bookkeeping
```

Use Tantivy or another dedicated search index for full-text search if SQLite FTS is not enough. Store that index in the same app-owned vault metadata directory, not inside the user vault.

### 3.4 Keep Markdown and metadata separate

The source file should stay clean:

```md
# Research note

This is the user's actual Markdown content.
```

Do not inject app-specific comment IDs into Markdown:

```md
<!-- vellum-comment:abc123 -->
```

Inline IDs pollute source and make the editor feel proprietary. They also violate the clean-folder stance when used as operational metadata.

### 3.5 Export/import is not live metadata storage

The app may support explicit export/import of metadata, but exported files are artifacts, not live operational state.

Allowed:

```txt
Export comments, LLM threads, suggestions, and metadata to a user-chosen JSON file.
Import a previously exported metadata bundle into app-owned storage.
Delete app metadata for a vault.
```

Not allowed in v1:

```txt
live `.vellum.sqlite` inside the vault
live `.vellum/` folder inside the vault
live `.bobapp/` folder inside the vault
app-managed hidden metadata in the user workspace
```

The app should not suggest the vault root as the default export location. If the user manually saves an export there, it is a user-created file, not an app-managed metadata store.

---

## 4. Storage topology

### 4.1 Global app database

```txt
app.db
```

Stores app-level state:

```sql
CREATE TABLE vaults (
    vault_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    current_root_path TEXT NOT NULL,
    root_fingerprint TEXT,
    created_at INTEGER NOT NULL,
    last_opened_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE TABLE vault_path_history (
    vault_id TEXT NOT NULL,
    root_path TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (vault_id, root_path)
);

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
```

### 4.2 Per-vault database

```txt
vaults/<vault_id>/vault.db
```

Stores vault-specific metadata:

```sql
CREATE TABLE documents (
    doc_id TEXT PRIMARY KEY,
    current_path TEXT NOT NULL,
    title TEXT,
    content_hash TEXT NOT NULL,
    last_seen_mtime INTEGER,
    last_seen_size INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE UNIQUE INDEX idx_documents_current_path
ON documents(current_path)
WHERE deleted_at IS NULL;

CREATE TABLE document_path_history (
    doc_id TEXT NOT NULL,
    path TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (doc_id, path)
);

CREATE TABLE document_revisions (
    revision_id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    parent_revision_id TEXT,
    content_hash TEXT NOT NULL,
    transaction_id TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE transactions (
    transaction_id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    origin TEXT NOT NULL,
    base_revision_id TEXT,
    resulting_revision_id TEXT NOT NULL,
    changes_json TEXT NOT NULL,
    inverse_changes_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE document_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    compressed_text BLOB NOT NULL,
    created_at INTEGER NOT NULL
);
```

### 4.3 Comments tables

```sql
CREATE TABLE comment_threads (
    thread_id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    status TEXT NOT NULL,
    anchor_json TEXT NOT NULL,
    selected_text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER
);

CREATE TABLE comment_messages (
    message_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    author_kind TEXT NOT NULL, -- local_user | assistant | system
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
```

### 4.4 LLM thread tables

```sql
CREATE TABLE llm_threads (
    llm_thread_id TEXT PRIMARY KEY,
    title TEXT,
    source_kind TEXT NOT NULL, -- comment | selection | document | global
    source_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE llm_messages (
    llm_message_id TEXT PRIMARY KEY,
    llm_thread_id TEXT NOT NULL,
    role TEXT NOT NULL, -- user | assistant | system | tool
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE llm_context_items (
    context_item_id TEXT PRIMARY KEY,
    llm_thread_id TEXT NOT NULL,
    doc_id TEXT,
    source_range_json TEXT,
    anchor_json TEXT,
    selected_text_snapshot TEXT,
    surrounding_context_snapshot TEXT,
    document_revision_id TEXT,
    created_at INTEGER NOT NULL
);
```

The distinction is required:

```txt
Comment thread:
  local annotation attached to a document range

LLM thread:
  conversation seeded by a comment, selection, document, or vault query

Context item:
  immutable snapshot of the exact document context sent to the model
```

---

## 5. Vault identity without a `.vellum/` file

### 5.1 Normal case

The vault is identified by the app database entry:

```txt
vault_id -> current_root_path
```

When the user reopens the same folder path, the app uses the existing `VaultId`.

### 5.2 Folder renamed or moved

If the old path is missing and the user opens a new folder, the app should attempt vault recovery:

```txt
1. scan the opened folder
2. compute root fingerprint
3. compare against known vault fingerprints
4. compare file path/content-hash overlap
5. if high confidence, ask user:
   “This looks like your previous vault: Research Notes. Reconnect metadata?”
```

Root fingerprint should be probabilistic, not a secret identifier:

```rust
pub struct VaultFingerprint {
    pub file_count: usize,
    pub sample_hashes: Vec<ContentHash>,
    pub normalized_path_samples: Vec<String>,
    pub computed_at: Timestamp,
}
```

### 5.3 File moved inside a vault

Detect with:

```txt
file watcher rename event when available
content hash match
mtime/size heuristic
path disappearance + new path appearance
```

If matched, update `documents.current_path` and append `document_path_history`.

### 5.4 Ambiguous recovery

If confidence is low, never silently attach old metadata.

Show a recovery UI:

```txt
“Possible match found”
“Create new vault identity”
“Reconnect to existing metadata”
“Import metadata from export”
```

---

## 6. Document kernel

### 6.1 Source buffer

Use a rope-backed source buffer.

```rust
pub struct Document {
    pub doc_id: DocId,
    pub text: Rope,
    pub revision_id: RevisionId,
    pub version: u64,
}
```

The source buffer stores raw Markdown, not rich-text structures.

### 6.2 Coordinate discipline

This section is load-bearing.

Different systems need different coordinate spaces, but they must not leak into each other casually.

```rust
pub struct ByteOffset(pub usize);      // UTF-8 source byte offset
pub struct CharIndex(pub usize);       // rope/internal Unicode scalar index
pub struct GraphemeIndex(pub usize);   // user-visible movement unit
pub struct LineCol {
    pub line: usize,
    pub column: usize,
}

pub struct SourceRange {
    pub start: ByteOffset,
    pub end: ByteOffset, // half-open: [start, end)
}
```

Canonical rule:

```txt
Persistence, parsing, semantic maps, transactions, anchors, search hits, and LLM context ranges use ByteOffset.
Cursor movement and visual selection use grapheme-aware positions only at the input/presentation edge.
CharIndex is an internal rope conversion detail and must not be stored in SQLite.
```

Allowed coordinate locations:

| System | Allowed persisted coordinate | Notes |
|---|---:|---|
| SQLite comments | `SourceRange` / `ByteOffset` | Plus hashes and fallbacks |
| Transactions | `SourceRange` / `ByteOffset` | All changes are source byte ranges |
| Parser | `SourceRange` / `ByteOffset` | Parser emits source ranges |
| Semantic map | `SourceRange` / `ByteOffset` | Node ranges are source ranges |
| Search hits | `SourceRange` / `ByteOffset` | Paths are display metadata only |
| LLM context packets | `SourceRange` / `ByteOffset` | Snapshot tied to revision |
| Renderer layout | source-backed positions plus screen geometry | No persisted layout coordinates |
| Cursor movement | grapheme positions, transient | Converted at boundary |
| Hit testing | screen point -> `ByteOffset` | Via layout map |
| Clipboard | plain source text | No rich-text canonical path |

All conversions happen through one module:

```rust
pub struct PositionMapper<'a> {
    pub doc: &'a DocumentSnapshot,
    pub line_index: &'a LineIndex,
    pub grapheme_index: &'a GraphemeIndexCache,
}

impl<'a> PositionMapper<'a> {
    pub fn byte_to_char(&self, offset: ByteOffset) -> CharIndex;
    pub fn char_to_byte(&self, index: CharIndex) -> ByteOffset;
    pub fn byte_to_line_col(&self, offset: ByteOffset) -> LineCol;
    pub fn line_col_to_byte(&self, pos: LineCol) -> ByteOffset;
    pub fn byte_to_grapheme(&self, offset: ByteOffset) -> GraphemeIndex;
    pub fn grapheme_to_byte(&self, index: GraphemeIndex) -> ByteOffset;
}
```

Non-negotiable test cases:

```txt
emoji
combined accents
CJK text
right-to-left text
mixed ASCII + multi-byte characters
selection across line boundaries
Markdown markers adjacent to multi-byte text
```

### 6.3 Text changes

```rust
pub enum TextChange {
    Insert {
        at: ByteOffset,
        text: String,
    },
    Delete {
        range: SourceRange,
        deleted_text_hash: ContentHash,
    },
    Replace {
        range: SourceRange,
        text: String,
        replaced_text_hash: ContentHash,
    },
}
```

All changes are interpreted against the transaction’s `base_revision`.

### 6.4 Transaction application

```rust
pub struct ApplyResult {
    pub new_revision_id: RevisionId,
    pub inverse: Vec<TextChange>,
    pub affected_ranges: Vec<SourceRange>,
    pub anchor_transform: AnchorTransform,
    pub semantic_dirty_hint: SemanticDirtyHint,
}
```

Every transaction emits:

```txt
inverse changes for undo/history
anchor transform data for comments/suggestions/highlights
semantic dirty hint for incremental parsing
```

### 6.5 Local history model

Use inverse patches as the primary local history store.

```txt
Transaction log:
  primary history mechanism
  stores forward changes and inverse changes

Snapshots:
  periodic checkpoints
  used for fast seeking, crash recovery, and compaction
```

Do not choose between “snapshots or reverse patches.” Use both, with different jobs.

Suggested policy:

```txt
store inverse changes for every transaction
store compressed full snapshot every N transactions or M bytes of patch drift
compact old transaction ranges only after a snapshot safely covers them
```

---

## 7. Anchor model for local comments

### 7.1 Anchor representation

```rust
pub struct CommentAnchor {
    pub doc_id: DocId,
    pub primary: AnchorStrategy,
    pub fallbacks: Vec<AnchorFallback>,
    pub selection_mode: SelectionMode,
    pub policy: CommentAnchorPolicy,
    pub created_at_revision: RevisionId,
}

pub enum AnchorStrategy {
    SourceRange(SourceRange),
    StructuralPath(StructuralAnchor),
    QuoteContext(QuoteContextAnchor),

    // reserved for future collaboration; not required in v1
    FutureCrdtRelativePosition(Vec<u8>),
}

pub struct StructuralAnchor {
    pub block_id: BlockId,
    pub block_path: MarkdownNodePath,
    pub node_kind: NodeKindId,
    pub local_range: SourceRange,
}

pub struct QuoteContextAnchor {
    pub selected_text: String,
    pub prefix: String,
    pub suffix: String,
    pub prefix_hash: ContentHash,
    pub suffix_hash: ContentHash,
}
```

### 7.2 Anchor policies

```rust
pub enum CommentAnchorPolicy {
    SemanticInnerContent,
    ExactSourceSelection,
    WholeMarkdownNode,
    WholeBlock,
}
```

Default behavior:

```txt
If user selects visually rendered bold text:
  SemanticInnerContent

If user selects visible Markdown markers too:
  ExactSourceSelection

If user comments from a heading/block action:
  WholeBlock or WholeMarkdownNode

If user comments from a node-level UI affordance:
  WholeMarkdownNode
```

### 7.3 Anchor resolution states

```rust
pub enum AnchorResolution {
    Resolved(SourceRange),
    Moved(SourceRange),
    Expanded(SourceRange),
    Contracted(SourceRange),
    TruncatedStart(SourceRange),
    TruncatedEnd(SourceRange),
    Replaced(SourceRange),
    Changed(SourceRange),
    Approximate {
        range: SourceRange,
        confidence: f32,
    },
    Collapsed {
        at: ByteOffset,
    },
    Orphaned,
}
```

UI implications:

```txt
Resolved/Moved/Expanded/Contracted:
  normal marker

Truncated/Replaced/Changed:
  normal marker with optional subtle “text changed” state

Approximate:
  visibly mark as approximate; user can reattach

Collapsed:
  marker becomes point annotation; user can reattach or dismiss

Orphaned:
  comment remains in sidebar but is detached from visible text
```

### 7.4 Anchor resolution pipeline

When opening a document or after an edit, resolve anchors in this order:

```txt
1. transaction-mapped source range
2. unchanged source range with matching selected text
3. structural node path / stable BlockId
4. quote/context search inside same block
5. quote/context search in whole document
6. orphaned anchor state
```

Approximate anchors must be visibly marked.

### 7.5 Deterministic anchor transform model

All anchor ranges are half-open:

```txt
[a, b)
```

All transforms operate in `ByteOffset`.

Definitions:

```txt
anchor = [a, b)
insert = position p, inserted byte length n
delete = [d0, d1), deleted byte length L = d1 - d0
replace = delete [d0, d1) then insert n bytes at d0
```

#### 7.5.1 Insert transform table

For `SemanticInnerContent` and `ExactSourceSelection`:

| Case | Condition | New range | Resolution |
|---|---|---|---|
| Insert before anchor | `p < a` | `[a + n, b + n)` | `Moved` |
| Insert at anchor start | `p == a` | `[a + n, b + n)` | `Moved` |
| Insert inside anchor | `a < p < b` | `[a, b + n)` | `Expanded` |
| Insert at anchor end | `p == b` | `[a, b)` | `Resolved` |
| Insert after anchor | `p > b` | `[a, b)` | `Resolved` |

Rationale:

```txt
A comment on selected text should not automatically absorb text typed immediately before or after the selection.
It should absorb text inserted inside the selected range.
```

For `WholeMarkdownNode` and `WholeBlock`:

| Case | Condition | New range | Resolution |
|---|---|---|---|
| Insert before container | `p < a` | `[a + n, b + n)` | `Moved` |
| Insert at start, same container | `p == a && same_container` | `[a, b + n)` | `Expanded` |
| Insert inside container | `a < p < b` | `[a, b + n)` | `Expanded` |
| Insert at end, same container | `p == b && same_container` | `[a, b + n)` | `Expanded` |
| Insert after container | `p > b` | `[a, b)` | `Resolved` |
| Boundary ambiguous | `p == a || p == b`, unknown container | transformed range + semantic snap | `Changed` |

`same_container` is determined by structural context when the edit is created, then verified after the semantic map updates.

#### 7.5.2 Delete transform table

For all policies, first apply the mechanical range transform:

| Case | Condition | New range | Resolution |
|---|---|---|---|
| Delete before anchor | `d1 <= a` | `[a - L, b - L)` | `Moved` |
| Delete after anchor | `d0 >= b` | `[a, b)` | `Resolved` |
| Delete covers whole anchor | `d0 <= a && b <= d1` | point at `d0` | `Orphaned` or `Collapsed` |
| Delete overlaps start | `d0 <= a && a < d1 && d1 < b` | `[d0, b - L)` | `TruncatedStart` |
| Delete inside anchor | `a < d0 && d1 < b` | `[a, b - L)` | `Contracted` |
| Delete overlaps end | `a < d0 && d0 < b && b <= d1` | `[a, d0)` | `TruncatedEnd` |

Then apply policy-specific validation:

| Policy | Extra validation |
|---|---|
| `SemanticInnerContent` | If semantic node still exists, prefer semantic snap to inner content. If selected text is fully deleted, `Orphaned`. |
| `ExactSourceSelection` | If selected source bytes are fully deleted, `Orphaned`. If partially deleted, keep truncated range and mark changed. |
| `WholeMarkdownNode` | If node identity survives, snap to updated node range. If node deleted, `Orphaned`. |
| `WholeBlock` | If block identity survives, snap to updated block range. If block deleted, `Orphaned`. |

If a transformed range becomes empty:

```txt
if selected text still recoverable by quote/context:
  Approximate or Moved
else if deletion clearly removed the selection:
  Orphaned
else:
  Collapsed at surviving boundary
```

#### 7.5.3 Replace transform table

A replace is modeled as:

```txt
delete [d0, d1)
insert replacement text at d0
```

But replacement semantics are not identical to delete-then-user-type because the inserted text semantically replaces the deleted source.

| Case | Condition | New range | Resolution |
|---|---|---|---|
| Replace before anchor | `d1 <= a` | shift by byte delta `n - L` | `Moved` |
| Replace after anchor | `d0 >= b` | `[a, b)` | `Resolved` |
| Replace covers whole anchor, replacement non-empty | `d0 <= a && b <= d1 && n > 0` | `[d0, d0 + n)` | `Replaced` |
| Replace covers whole anchor, replacement empty | `d0 <= a && b <= d1 && n == 0` | point at `d0` | `Orphaned` or `Collapsed` |
| Replace inside anchor | `a < d0 && d1 < b` | `[a, b + (n - L))` | `Changed` |
| Replace overlaps start | `d0 <= a && a < d1 && d1 < b` | `[d0, b + (n - L))` | `TruncatedStart` or `Changed` |
| Replace overlaps end | `a < d0 && d0 < b && b <= d1` | `[a, d0 + n)` | `TruncatedEnd` or `Changed` |

For `WholeMarkdownNode` and `WholeBlock`, semantic snap runs after this mechanical transform. If the structural node survives, the final range is the updated node/block range.

#### 7.5.4 Transform result type

```rust
pub struct AnchorTransformResult {
    pub old_range: SourceRange,
    pub transformed_range: Option<SourceRange>,
    pub resolution: AnchorResolution,
    pub requires_semantic_snap: bool,
    pub requires_quote_recovery: bool,
    pub confidence: f32,
}
```

The transform engine must not return vague statuses. Every result is one of the known `AnchorResolution` values.

### 7.6 Anchor transform engine

```rust
pub trait AnchorTransformEngine {
    fn transform_anchor(
        &self,
        anchor: &CommentAnchor,
        tx: &DocTransaction,
        semantic_map_before: &SemanticMap,
        semantic_map_after: Option<&SemanticMap>,
    ) -> AnchorTransformResult;
}
```

Rules:

```txt
1. Apply mechanical source transform.
2. Apply policy-specific validation.
3. If structural anchor exists, snap through stable BlockId/node path.
4. If validation fails, run quote/context recovery.
5. If recovery fails, mark approximate/collapsed/orphaned.
```

### 7.7 Required anchor tests

For every `CommentAnchorPolicy`, test:

```txt
insert before
insert at start
insert inside
insert at end
insert after
delete before
delete covering start
delete inside
delete covering end
delete whole anchor
replace before
replace inside
replace whole anchor
replace partial anchor
multi-byte characters before anchor
multi-byte characters inside anchor
Markdown marker reveal/collapse around anchor
external file edit producing same diff
```

R7 cannot be considered done until these tests exist.

---

## 8. Comments as local LLM context handles

### 8.1 Product model

A comment is not only a note. It is also a handle for asking the model about a precise part of the document.

User flow:

```txt
select text
create comment
write question or instruction
send to LLM chat
receive response
optionally convert response into suggested edit
accept/reject patch
```

### 8.2 Comment-to-chat context packet

When a comment is sent to the model, build a context packet.

```rust
pub struct LlmContextPacket {
    pub thread_id: LlmThreadId,
    pub source_comment_id: Option<CommentThreadId>,
    pub doc_id: DocId,
    pub document_path: String,
    pub document_title: Option<String>,
    pub current_revision_id: RevisionId,
    pub anchor_resolution: AnchorResolution,
    pub selected_text: String,
    pub surrounding_block: String,
    pub heading_path: Vec<String>,
    pub frontmatter: Option<String>,
    pub nearby_links: Vec<String>,
}
```

The packet stores a snapshot of what was sent. The live anchor remains attached to the document.

Why this matters:

```txt
The user can see what the model saw.
The model response remains auditable.
Later document edits do not rewrite chat history.
The comment can still resolve to current text.
```

### 8.3 AI suggestions are patches, not automatic edits

The model should return structured suggestions where possible.

```rust
pub struct SuggestedEdit {
    pub suggestion_id: SuggestionId,
    pub doc_id: DocId,
    pub source_thread_id: Option<LlmThreadId>,
    pub anchor: CommentAnchor,
    pub base_revision_id: RevisionId,
    pub patch: TextPatch,
    pub status: SuggestionStatus,
}

pub enum SuggestionStatus {
    Pending,
    Accepted,
    Rejected,
    Superseded,
}
```

Accepting a suggestion emits a normal transaction:

```rust
TransactionOrigin::AiSuggestedEditAccepted
```

This keeps history honest.

---

## 9. Live Preview architecture

### 9.1 Editor modes

```rust
pub enum EditorMode {
    SourceMode,
    LivePreview,
    ReadingView,
}
```

### 9.2 Presentation states

```rust
pub enum PresentationState {
    RenderedPreview,
    RevealedSourceStyled,
    PlainSource,
    WidgetPreview,
    WidgetSource,
}
```

### 9.3 Active context

```rust
pub struct ActiveContext {
    pub mode: EditorMode,
    pub selection: Selection,
    pub active_line: LineId,
    pub active_nodes: SmallVec<[NodeId; 8]>,
    pub structural_context: StructuralEditContext,
    pub composition_active: bool,
}
```

### 9.4 Node-specific rule registry

Avoid a giant chain of conditionals.

Use a registry:

```rust
pub trait PresentationRule: Send + Sync {
    fn resolve(
        &self,
        node: SemanticNodeRef<'_>,
        ctx: &ActiveContext,
        out: &mut PresentationBuilder,
    ) -> RuleResult;
}

pub struct PresentationRegistry {
    rules_by_kind: HashMap<NodeKindId, SmallVec<[RuleId; 4]>>,
    global_rules: SmallVec<[RuleId; 8]>,
}
```

Built-in behavior can use enum dispatch for performance:

```rust
pub enum BuiltinRule {
    Heading(HeadingRule),
    DelimitedInline(DelimitedInlineRule),
    InlineCode(InlineCodeRule),
    Link(LinkRule),
    WikiLink(WikiLinkRule),
    ListItem(ListItemRule),
    BlockContainer(BlockContainerRule),
    Widget(WidgetRule),
    Table(TableRule),
}
```

Extensions can use trait objects later.

### 9.5 Behavior table

| Node type | Inactive | Active |
|---|---|---|
| Heading | hide `#`, show heading style | reveal `#`, keep heading style |
| Bold | hide `**`, bold inner text | reveal `**`, keep bold style |
| Italic | hide delimiters | reveal delimiters, keep italic style |
| Strikethrough | hide `~~` | reveal `~~`, keep strike style |
| Inline code | hide backticks, show code chip | reveal backticks, keep code treatment |
| Wikilink | show alias/title | reveal `[[target|alias]]` |
| Standard link | show label | reveal `[label](url)` |
| Bullet list | render list marker | keep list style unless editing marker boundary |
| Numbered list | render list item | structural edit behavior at marker boundary |
| Callout | render callout | reveal active header/line source |
| Embed/image | widget preview | raw source when selected/entered |

### 9.6 Presentation plan

The presentation engine emits a plan, not draw calls.

```rust
pub struct PresentationPlan {
    pub revision_id: RevisionId,
    pub viewport: SourceRange,
    pub spans: Vec<PresentationSpan>,
    pub collapsed_ranges: Vec<CollapsedRange>,
    pub widgets: Vec<WidgetPresentation>,
    pub hit_zones: Vec<HitZone>,
    pub structural_zones: Vec<StructuralEditZone>,
}

pub struct PresentationSpan {
    pub source_range: SourceRange,
    pub visible_text: String,
    pub style: ResolvedStyle,
    pub state: PresentationState,
    pub node_id: Option<NodeId>,
}
```

The renderer consumes this plan. It does not decide what Markdown syntax means.

### 9.7 Hidden syntax and cursor movement

Hidden syntax is not deleted. It is collapsed in presentation.

Cursor movement must respect collapsed ranges:

```txt
left/right arrow cannot land inside hidden marker bytes
backspace at structural boundaries invokes structural command behavior
selection can expand to exact source when user intentionally reveals/selects markers
```

Collapsed ranges are source ranges, not visual spans. Hit testing maps visible positions back to legal source offsets.

---

## 10. Markdown semantic map

### 10.1 Do not parse only visible text without context

Live Preview needs full document context.

A visible line may depend on:

```txt
an opening code fence above the viewport
list nesting above the viewport
a blockquote/callout container
frontmatter state
link/reference definitions
table boundaries
```

Use a document-level semantic map, but update it incrementally.

### 10.2 Semantic map structure

```rust
pub struct SemanticMap {
    pub revision_id: RevisionId,
    pub blocks: SlotMap<BlockId, BlockNode>,
    pub inline_nodes: SlotMap<NodeId, InlineNode>,
    pub line_to_block: Vec<BlockId>,
    pub dirty_blocks: SmallVec<[BlockId; 16]>,
}

pub struct BlockNode {
    pub id: BlockId,
    pub kind: BlockKind,
    pub source_range: SourceRange,
    pub inner_range: SourceRange,
    pub parent: Option<BlockId>,
    pub children: SmallVec<[BlockId; 8]>,
    pub content_hash: ContentHash,
    pub structural_fingerprint: StructuralFingerprint,
}
```

### 10.3 Incremental update contract

On edit:

```txt
1. Convert transaction affected ranges to dirty line ranges.
2. Expand dirty ranges to Markdown-safe block boundaries.
3. Reparse only dirty block windows.
4. Reuse unchanged blocks by identity.
5. Shift source ranges for unaffected blocks after the edit.
6. Rebuild inline nodes only inside changed blocks.
7. Preserve BlockId for blocks that survive.
```

Full-document rebuild is allowed for:

```txt
initial file load
large external replacement
parser recovery after severe ambiguity
debug mode
```

It is not allowed on every keystroke in normal editing.

### 10.4 Dirty window expansion

A local edit dirty range should expand to the nearest safe parse boundary.

Safe boundaries include:

```txt
blank line between block constructs
start/end of fenced code block
start/end of frontmatter
top-level block boundary
list container boundary
callout boundary
```

If the parser cannot establish a safe boundary, it may widen the dirty window, but it should report that widening for performance telemetry.

```rust
pub struct SemanticDirtyHint {
    pub changed_source_ranges: SmallVec<[SourceRange; 4]>,
    pub changed_line_ranges: SmallVec<[LineRange; 4]>,
    pub requires_full_reparse: bool,
}
```

### 10.5 Stable block identity

Stable `BlockId` is a contract because comments and structural anchors depend on it.

A block keeps its `BlockId` if one of these conditions holds:

```txt
1. Its content hash is unchanged after source range shifting.
2. It has the same structural fingerprint and one-to-one overlap with the previous block.
3. It is matched by surrounding stable sibling blocks and same block kind.
```

```rust
pub struct StructuralFingerprint {
    pub kind: BlockKind,
    pub normalized_prefix: String,
    pub parent_kind: Option<BlockKind>,
    pub heading_level: Option<u8>,
    pub stable_text_sample_hash: Option<ContentHash>,
}
```

If identity is ambiguous, do not guess silently. Mark the block as new and let anchor recovery handle affected comments.

### 10.6 Inline node identity

Inline node identity is weaker than block identity.

Use:

```txt
block_id
+ node kind
+ local source range
+ delimiter/source fingerprint
```

Inline nodes can be regenerated inside changed blocks. Comment anchors should not depend only on inline `NodeId`; they should also store source range, quote context, and containing `BlockId`.

---

## 11. Focus, selection, and input ownership

The app has multiple UI surfaces:

```txt
canvas editor
hidden IME input
comment sidebar
LLM chat panel
command palette
settings
file tree
tabs/split panes
```

Only one surface owns focus at a time.

```rust
pub enum FocusOwner {
    Editor(EditorSessionId),
    CommentPanel(CommentThreadId),
    LlmChat(LlmThreadId),
    CommandPalette,
    FileTree,
    Settings,
}
```

### 11.1 Editor selection ownership

The WASM editor engine owns canonical editor selection for a session.

The TypeScript shell may hold a snapshot:

```rust
pub struct SelectionSnapshot {
    pub session_id: EditorSessionId,
    pub doc_id: DocId,
    pub revision_id: RevisionId,
    pub source_range: SourceRange,
    pub selected_text_hash: ContentHash,
}
```

Comment and LLM panels act on snapshots unless the editor explicitly grants live selection access.

### 11.2 Hidden input ownership

The hidden input is active only when `FocusOwner::Editor(_)`.

During IME composition:

```txt
focus is locked to editor
composition events mutate the pending composition state
DOM panels cannot steal focus without canceling or committing composition
```

### 11.3 Commands

Commands must declare whether they require editor focus.

```rust
pub enum CommandFocusRequirement {
    EditorSelection,
    DocumentContext,
    AnyFocus,
    NoFocus,
}
```

Examples:

```txt
Toggle bold:
  requires EditorSelection

Create comment from selection:
  requires EditorSelection or SelectionSnapshot

Send comment to LLM:
  requires CommentThreadId, not live editor focus

Apply suggestion:
  requires document revision validation before mutation
```

This avoids bugs where the chat panel focus accidentally mutates the editor or stale selections produce wrong edits.

---

## 12. Rendering and test backends

### 12.1 Renderer interface

The renderer consumes layout and presentation output.

```rust
pub trait Renderer {
    fn begin_frame(&mut self, viewport: Viewport);
    fn draw_text_run(&mut self, run: LaidOutTextRun);
    fn draw_selection(&mut self, selection: SelectionGeometry);
    fn draw_cursor(&mut self, cursor: CursorGeometry);
    fn draw_widget(&mut self, widget: WidgetGeometry);
    fn draw_comment_marker(&mut self, marker: CommentMarkerGeometry);
    fn end_frame(&mut self);
}
```

### 12.2 Canvas2D renderer

Canvas2D is the first shipping visual renderer.

It must support:

```txt
viewport rendering
dirty-region redraw
text run drawing
selection/caret drawing
comment markers
widget placeholders
```

### 12.3 Future GPU renderer

A GPU renderer is allowed later, but only after measurement.

Do not let GPU ambitions block v1.

### 12.4 Debug DOM renderer

The Debug DOM renderer mirrors the `PresentationPlan` into DOM nodes.

It should include:

```txt
data-source-range
data-node-id
data-presentation-state
data-collapsed-range
visible text content matching presentation output
```

Purpose:

```txt
Live Preview correctness oracle
source range inspection
development debugging
accessibility experiment surface
fixture-based tests
```

The DOM renderer does not replace the canvas renderer. It tests it.

### 12.5 Snapshot test renderer

The Snapshot renderer records normalized render commands.

```rust
pub struct SnapshotRenderer {
    pub commands: Vec<DrawCommand>,
}
```

Use it for:

```txt
golden tests
presentation state regression tests
collapsed syntax tests
comment marker tests
selection geometry tests
```

Pixel tests should be limited. Most correctness bugs are better caught at the presentation-plan and draw-command levels.

---

## 13. System architecture

```txt
Tauri application
├─ TypeScript app shell
│  ├─ workspace layout
│  ├─ tabs and split panes
│  ├─ command palette
│  ├─ comments UI
│  ├─ LLM chat panels
│  ├─ review/suggestions UI
│  ├─ settings
│  ├─ focus controller
│  └─ canvas/input host
│
├─ Rust/WASM editor engine
│  ├─ document kernel
│  ├─ coordinate mapper
│  ├─ transaction engine
│  ├─ anchor transform engine
│  ├─ incremental semantic map
│  ├─ Live Preview rule registry
│  ├─ presentation planner
│  ├─ layout engine
│  └─ renderer command generation
│
├─ Renderer backends
│  ├─ Canvas2D renderer
│  ├─ future GPU renderer
│  ├─ Debug DOM renderer
│  └─ Snapshot test renderer
│
└─ Native Rust backend
   ├─ vault filesystem
   ├─ app-data storage manager
   ├─ SQLite metadata store
   ├─ file watcher
   ├─ external edit reconciler
   ├─ comments and LLM thread store
   ├─ search index
   ├─ backlinks and graph index
   ├─ embeddings/vector index
   └─ AI provider adapter
```

Key seam:

```txt
Hot path:
  WASM editor engine

Disk/index/AI path:
  native Rust backend

Product UI:
  TypeScript app shell
```

The JS host should not be “thin” globally. It should be **non-hot-path**.

---

## 14. Filesystem and external edits

### 14.1 Source files

The backend owns file IO:

```rust
pub trait VaultFs {
    fn open_vault(path: PathBuf) -> Result<VaultId>;
    fn load_doc(doc_id: DocId) -> Result<DocumentSnapshot>;
    fn save_doc(doc_id: DocId, text: &str, base_revision: RevisionId) -> Result<SaveResult>;
}
```

### 14.2 External change detection

When an external editor changes a file:

```txt
1. detect file change
2. read new file content
3. compare to last saved revision
4. diff old -> new
5. convert diff into TransactionOrigin::ExternalFileChange
6. apply transaction
7. transform anchors
8. update semantic map
9. update comments/suggestions/search/backlinks
```

### 14.3 Conflict handling

If local unsaved edits and external edits conflict:

```txt
try merge
if safe, apply
if ambiguous, show conflict UI
never silently drop comments or local edits
```

---

## 15. Search, backlinks, graph, and AI index

Search/indexing must not block typing.

Suggested split:

```txt
SQLite:
  document metadata
  comments
  LLM threads
  backlinks
  tags
  frontmatter
  graph edges

Tantivy or equivalent:
  full-text search

Vector store:
  semantic chunks / embeddings
```

All index records map back to `DocId` and `SourceRange`.

```rust
pub struct SearchHit {
    pub doc_id: DocId,
    pub path: String,
    pub score: f32,
    pub snippet: String,
    pub ranges: Vec<SourceRange>,
}
```

Do not return only paths. Paths change.

---

## 16. Privacy and user control

Local comments and LLM chats can contain sensitive text.

Requirements:

```txt
metadata stays local by default
LLM provider is explicit
context sent to model is inspectable
chat history can be deleted
a comment can be detached from AI history
vault metadata can be exported
vault metadata can be purged
```

If cloud LLMs are used, the app should show what document context is being sent before first use.

---

## 17. Metadata export, import, and purge

V1 metadata is stored in app-owned SQLite outside the vault. There is no portable live metadata mode.

### 17.1 Export bundle

The app may generate an explicit export artifact:

```txt
vellum-export-2026-05-27.json
```

Contains:

```txt
vault fingerprint
vault registry metadata
stable document IDs
path history
comments
comment messages
LLM threads
LLM messages
LLM context packets
AI suggestions
anchor metadata
revision metadata if the user chooses to include history
```

The export bundle is a user-visible artifact. It is not a live database and the app must not treat it as operational metadata.

### 17.2 Import bundle

Import reads a user-selected export bundle and writes the recovered data into app-owned storage:

```txt
AppData/Vellum/app.db
AppData/Vellum/vaults/<vault_id>/vault.db
```

Import must never create `.vellum/`, `.vellum.sqlite`, `.bobapp/`, or any hidden metadata folder inside the vault.

### 17.3 Purge metadata

Users must be able to delete app-owned metadata for a vault without deleting Markdown files.

Purge deletes:

```txt
comments
comment messages
LLM threads
LLM context packets
AI suggestions
local revision metadata
snapshots
search indexes
embeddings
vault registry entry
```

Purge does not delete:

```txt
.md files
attachments
user-created folders
```

### 17.4 Reconnect after reinstall or move

If app-owned metadata is missing because the user reinstalled the app, moved machines, or purged app data, the vault remains usable because Markdown files are canonical.

The app may support recovery by:

```txt
asking the user to import a previous metadata export
recreating document identities from file paths and content hashes
rebuilding search/backlink indexes
starting with no comments/history if no export exists
```

No recovery flow may create operational metadata inside the vault.

---

## 18. Idiomatic Rust extensibility

### 18.1 Use data-driven registries at boundaries

Use registries for systems that need extension:

```txt
presentation rules
Markdown syntax extensions
commands
AI context builders
anchor recovery strategies
indexers
exporters
```

### 18.2 Use enums for core built-ins

Inside the hot path, prefer enums and static dispatch when behavior is closed and performance-sensitive.

```rust
pub enum CoreCommand {
    InsertText,
    DeleteBackward,
    ToggleBold,
    ToggleItalic,
    CreateComment,
    SendCommentToLlm,
}
```

### 18.3 Use trait objects for open extension points

```rust
pub trait CommandHandler: Send + Sync {
    fn id(&self) -> CommandId;
    fn run(&self, ctx: CommandContext) -> CommandResult;
}

pub trait AiContextBuilder: Send + Sync {
    fn build_context(&self, input: AiContextInput) -> Result<LlmContextPacket>;
}

pub trait AnchorRecoveryStrategy: Send + Sync {
    fn recover(&self, input: AnchorRecoveryInput) -> AnchorRecoveryResult;
}
```

### 18.4 Avoid giant conditional chains

Bad:

```rust
if node.kind == Heading && cursor_inside { ... }
else if node.kind == Strong && cursor_inside { ... }
else if node.kind == Link && cursor_inside { ... }
```

Good:

```rust
let rules = registry.rules_for(node.kind_id());
for rule in rules {
    if rule.resolve(node, ctx, out).is_terminal() {
        break;
    }
}
```

---

## 19. Production milestones

These are production-readiness slices, not toy prototypes. The sequencing is risk-first: prove the custom editor and anchor model before spending too much effort on well-understood storage plumbing.

### R0: Architecture contract

Build:

```txt
product invariants
storage decision
Markdown canonicality contract
metadata separation contract
comment/LLM workflow contract
coordinate discipline contract
```

Exit gate:

```txt
The team agrees that v1 is local-only, app-data-backed, source-preserving, and comments are local AI context handles.
```

### R1: Document kernel, coordinate mapper, and transactions

Build:

```txt
rope-backed document
SourceRange / ByteOffset discipline
PositionMapper
grapheme-aware cursor movement
transaction application
undo/redo
inverse patches
semantic dirty hints
```

Exit gate:

```txt
Edits are deterministic, undoable, and all persisted ranges use ByteOffset. Multi-byte character tests pass.
```

### R2: Plain editor surface and focus/input spine

Build:

```txt
Canvas2D text rendering
hidden input overlay
basic IME path
selection geometry
caret geometry
hit testing
FocusOwner model
viewport virtualization
dirty-region redraw
```

Exit gate:

```txt
The editor can type, select, scroll, paste, and maintain focus correctly while DOM side panels exist.
```

### R3: Incremental semantic map and Live Preview rule system

Build:

```txt
block map
inline node map
stable BlockId contract
incremental dirty window parser
PresentationState
ActiveContext
PresentationRule trait
builtin rule registry
Debug DOM renderer
Snapshot renderer
```

Exit gate:

```txt
Obsidian-style source reveal works for headings, bold, italic, strikethrough, inline code, links, wikilinks, lists, and callouts, with test fixtures comparing PresentationPlan output.
```

### R4: Anchor transform engine and in-editor local comments

Build:

```txt
anchor policies
anchor transform truth tables
transform tests
comment creation from selection
comment markers
comment sidebar
anchor update after local edits
```

Exit gate:

```txt
A comment on formatted text survives source reveal/collapse and local edits before, inside, overlapping, and after the range.
```

### R5: App-data persistence for documents, transactions, and comments

Build:

```txt
app.db
per-vault vault.db
vault registry
document table
revision table
transaction table
comment tables
storage migrations
snapshot checkpoints
```

Exit gate:

```txt
A comment survives save, app restart, reload, and file rename without creating `.vellum/` in the user folder.
```

### R6: File IO and external edits

Build:

```txt
load/save
file watcher
external diff
external transaction conversion
anchor transform after external edit
conflict UI for ambiguous cases
```

Exit gate:

```txt
External edits do not silently destroy comments, local edits, or document identity.
```

### R7: Comment-to-LLM workflow

Build:

```txt
send comment to chat
context packet builder
LLM thread store
context snapshot viewer
provider adapter
response persistence
```

Exit gate:

```txt
The user can comment on a selection, send it to an LLM chat, inspect what context was sent, and return to the anchored comment.
```

### R8: AI suggested edits

Build:

```txt
structured patch suggestions
accept/reject
preview diff
apply as transaction
suggestion history
```

Exit gate:

```txt
LLM output can become a reviewable patch instead of direct document mutation.
```

### R9: Search, backlinks, and graph

Build:

```txt
full-text index
wikilink resolver
backlink index
tag/frontmatter index
graph edge store
search hit source ranges
```

Exit gate:

```txt
Search and backlinks work across a real vault and never block typing.
```

### R10: Accessibility and IME hardening

Build:

```txt
semantic accessibility plane
screen-reader navigation
selection exposure
heading navigation
comment discovery
keyboard-only operation
IME matrix across target platforms
```

Exit gate:

```txt
The editor is usable without relying on the canvas visual plane alone, and non-Latin input is stable across target platforms.
```

### R11: Performance hardening

Build:

```txt
render benchmarks
large-note benchmarks
semantic map update benchmarks
anchor transform benchmarks
indexing benchmarks
storage benchmarks
memory profiling
layout cache tuning
```

Exit gate:

```txt
Performance is measured against real vaults, not intuition.
```

### R12: Metadata export, import, and purge

Build:

```txt
export comments/AI threads/suggestions to a user-visible bundle
import metadata bundle into app-owned SQLite
purge app-owned vault metadata without deleting Markdown files
metadata recovery UI for reinstall/moved-machine cases
```

Exit gate:

```txt
Users can back up, restore, or delete Vellum metadata without the app creating `.vellum/`, `.vellum.sqlite`, `.bobapp/`, or any hidden metadata store inside the vault.
```

### R13: Future collaboration preparation

Build only after local correctness is strong:

```txt
multi-actor transaction model
CRDT feasibility test
relative anchor migration
sync conflict model
shared comments design
```

Exit gate:

```txt
The existing local transaction/comment/storage model can migrate to collaboration without rewriting the editor core.
```

---

## 20. Decisions locked by this version

```txt
No `.vellum/` sidecar inside the vault.
No `.vellum.sqlite` inside the vault.
No `.bobapp/` inside the vault.
Metadata lives in app-owned storage outside the vault.
SQLite is the durable local metadata store.
Comments are first-class local features, not collaboration leftovers.
Comments can seed LLM chats.
LLM context snapshots are stored separately from live comment anchors.
AI edits are suggestions/patches before they become source mutations.
CRDT is not required for v1.
The transaction and anchor model must remain CRDT-compatible later.
All persisted source ranges use ByteOffset.
Grapheme positions are transient input/presentation coordinates.
Anchor transforms are deterministic and table-driven.
Semantic mapping is incremental and block-stable.
Debug DOM and Snapshot renderers are part of the test strategy.
Inverse patches are primary local history; snapshots are checkpoints.
```

---

## 21. Remaining open questions

1. What exact threshold should mark quote/context recovery as approximate vs orphaned?
2. Should whole-block comments snap to the block after Markdown structural edits, or remain on the transformed source range until user confirms?
3. Should the Debug DOM renderer also serve as the first accessibility bridge, or should accessibility use a separate semantic tree from the start?
4. How much surrounding context should a comment send to the LLM by default?
5. Should comment text itself be included in the LLM prompt automatically?
6. Should users be able to create comments without visible sidebar clutter?
7. Should comments export as Markdown footnotes, JSON, or both?
8. How should the app recover metadata if the user reinstalls the app but keeps the Markdown vault?
9. Should AI provider credentials live in app config, keychain, or both?
10. Should stable `BlockId` be generated randomly at first observation or deterministically from structural fingerprints?
11. How aggressively should the dirty semantic parse window expand for ambiguous Markdown constructs?

---

## 22. One-sentence architecture

Vellum v1 is a local-first Markdown editor where `.md` files stay clean, app-owned SQLite metadata stores comments/history/AI context outside the vault, Live Preview is rule-driven and source-preserving, every source edit flows through a byte-range transaction model, comments move through deterministic anchor transforms, and the renderer is replaceable because semantics live above rendering.
