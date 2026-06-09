# Compose — product & architecture spec (current)

This is the current, code-accurate overview of what Compose is and how it is
built. It replaces the archived `vellum-*` production specs (see
[`docs/archive/`](archive/)), which describe a removed Canvas/WASM editor and a
pre-streaming agent.

This doc is the **map**; the **terrain** is the three domain guides, which carry
the hard-won, non-obvious constraints:

- [`editor-guide.md`](editor-guide.md) — editor, coordinates, comments, search,
  the lag benchmark.
- [`ipc-guide.md`](ipc-guide.md) — Tauri command threading + the harness crate
  topology.
- [`review-guide.md`](review-guide.md) — the edit-review gate, version history,
  recoverable trash.

For the path to 1.0, see [`RELEASE.md`](../RELEASE.md).

---

## 1. Product

**Compose is a local-first AI writing workspace — "AI for everyone."** You open
a folder of Markdown files; you write in a clean editor; and a built-in AI agent
can read and edit those files for you, with every edit gated through a safety
review and a full undo history.

**Target user:** non-technical. No git, no terminal, no provider-key juggling
required to get value. The app must be self-explanatory and never lose a user's
work.

**Core promise:**

- Your files stay **plain `.md`** in **your** folder. No vendor lock-in, no
  hidden sidecar files inside the vault.
- A clean **WYSIWYG + source** editor (Obsidian-like), fully Markdown-compliant,
  with cross-file links.
- An **AI agent** that can edit your documents — but **never without a safety
  net**: you review the diff, or every edit is snapshotted for one-click undo.
- **Local-first**: everything works offline against your folder; app metadata
  lives in app-data SQLite, never in the vault.

**Non-goals for v1:** cloud sync, real-time multiplayer/CRDT, a plugin
marketplace, a first-class terminal, mobile. (Seams for some of these exist; the
features do not ship in v1.)

---

## 2. Architecture at a glance

```
┌───────────────────────────────────────────────────────────────┐
│ React + TypeScript (Vite)            src/                       │
│  • Tiptap/ProseMirror editor         • Zustand workspace store  │
│  • Carbon UI shell                   • PositionMapper (coords)  │
│  • markdown preview in a web worker  • IPC clients (src/lib/ipc)│
└───────────────▲───────────────────────────────────────────────┘
                │ Tauri IPC (every command is async)
┌───────────────┴───────────────────────────────────────────────┐
│ Rust host (Tauri 2)                  src-tauri/                 │
│  • files (atomic write, watcher, trash)                         │
│  • db (SQLite: history, snapshots, comments, conversations)     │
│  • review (EditGuard: clone / snapshot / diff / apply)          │
│  • index (full-text search over the vault)                      │
│  • bob/runner (harness dispatch + streaming)                    │
└───────────────▲───────────────────────────────────────────────┘
                │ crates.io deps
┌───────────────┴───────────────────────────────────────────────┐
│ agent-harness (Harness trait, bob/claude/codex adapters)        │
│   └── cli-stream (process streaming) · bob-rs (bob SDK)         │
│ workspace-index (pure index/search core → native + WASM)        │
└───────────────────────────────────────────────────────────────┘
```

**The split:** TypeScript owns the interactive editor and all coordinate logic;
Rust owns persistence (SQLite), the filesystem, search, and the agent runner.
The harness framework lives in its **own published crate family**
(`agent-harness`), consumed from crates.io — see [`ipc-guide.md`](ipc-guide.md).

**Tech stack:** Tauri 2, React 18, TypeScript, Vite, Zustand, Tiptap 3 /
ProseMirror, `@carbon/react`, `unified`/`remark`/`rehype` (preview worker), Rust
+ rusqlite, `wasm-pack`.

---

## 3. The storage contract (non-negotiable)

**Your files are canonical; app data never enters the vault.** The Markdown
folder contains only the user's `.md` files and their assets. Everything Compose
derives — comments, version history, snapshots, search index, conversation
history, LLM context — lives in the OS **app-data** directory as SQLite, keyed
by vault. There is **no `.compose/`, no `.sqlite`, no hidden store** inside the
user's folder.

Consequences:
- The file on disk is the source of truth; SQLite is a sidecar, never the
  authority on content.
- A document has an identity that survives renames/moves (tracked in
  `document_path_history`), so comments and history follow the document, not the
  path.
- Deleting the app's metadata can never corrupt the user's writing.

---

## 4. Editor

- **Tiptap / ProseMirror** owns the document model, input, and rendering
  ([`src/features/editor/TiptapMarkdownEditor.tsx`](../src/features/editor/TiptapMarkdownEditor.tsx)).
  WYSIWYG + a source mode, with the full Markdown construct set (headings,
  emphasis, code, lists, tables, task lists, links, images, blockquotes) plus
  YAML frontmatter preserved across round-trips.
- **Markdown preview** is `unified` + `remark` + `rehype` running in a web
  worker — off the input thread.
- **Coordinate discipline:** one owner for byte ↔ code-unit conversion,
  [`PositionMapper`](../src/features/text/positionMapper.ts). Persisted positions
  (comment anchors, search hits, index ranges) are always UTF-8 **byte** offsets;
  code-unit indices are transient, boundary-only. Do not re-derive conversions
  elsewhere. See [`editor-guide.md`](editor-guide.md).
- **Comments** anchor to byte-ranges and survive edits via deterministic anchor
  transforms; they can be sent to the agent as context.
- **Latency budget:** "every interaction under one frame, every file size." The
  lag benchmark (`pnpm bench:baseline`) is a gate; the comment overlay scans only
  the visible window.

---

## 5. Search & index

One pure-Rust core, [`crates/workspace-index`](../crates/workspace-index),
compiles to **two targets**: native (the Tauri command scans the real folder)
and **WASM** (the browser-preview build runs the same code over a virtual
workspace). It extracts headings, tags, links (markdown + wikilink), and
frontmatter, builds a snapshot, and mirrors records into SQLite for backlinks.
**Never reimplement index/search in TypeScript** — change it once, in the core.

---

## 6. The AI agent runner

- **Harnesses, not a hardcoded backend.** A *harness* is an agent backend
  implementing `agent-harness`'s `Harness` trait. Built-in adapters: **bob**
  (default), **Claude Code**, **Codex**. A harness declares
  `HarnessCapabilities` (credential required? previews its own edits? model list,
  effort, max-turns); the frontend branches on **capabilities, never on harness
  id**.
- **Streaming transport** is neutral: `run_harness_stream`
  ([`src-tauri/src/bob/runner.rs`](../src-tauri/src/bob/runner.rs)) routes by
  harness id, builds a neutral `RunRequest`, and streams normalized `RunEvent`s
  (assistant text, thinking, tool start/stop, usage) to the UI on one channel.
  Cancel (`cancel_harness_run`) works mid-run because every command is `async`.
- **Conversations** are persisted (SQLite): list, load, rename, archive,
  duplicate, soft-delete + undo.

---

## 7. The edit-review safety gate

This is the product's differentiator and exists because Claude/Codex write to
files **directly** (they don't preview edits). For a non-technical user, an
agent changing files with no review and no undo is unacceptable. Every
write-capable run resolves to one of three `EditGuard` modes
([`src-tauri/src/review/mod.rs`](../src-tauri/src/review/mod.rs)):

| Mode | When | Behavior |
|---|---|---|
| `none` | harness previews its own edits (bob), or a read-only run | unchanged |
| `clone` | write-capable harness, review **ON** (default) | run the agent in a COW clone of the vault; diff clone vs real after; user accepts/rejects per file |
| `snapshot` | write-capable harness, review **OFF** | snapshot a baseline first; agent edits real files directly, but every edit stays undoable |

**Review is ON by default.** The clone lives outside the watched vault (so the
real editor never flickers mid-run), the post-run diff is by **content hash**
(never miss a change), and apply is atomic. See
[`review-guide.md`](review-guide.md) for the full clone/diff/apply path and its
invariants.

---

## 8. Version history & recoverable trash (git-free undo)

Most target users have no git and don't understand commits, so undo is
home-grown:

- **Version history:** per-file content **snapshots** (compressed, deflate;
  count-based retention of the newest 50, with the latest revision + audit-trail
  revisions always protected). List newest-first, restore any version (the
  restore itself snapshots current first, so it's undoable).
- **Recoverable trash:** delete is **soft-delete only** — snapshot to history,
  then move the physical file to an app-data trash outside the vault (never
  `unlink`). A 30-day startup sweep permanently purges old trash, tracked by DB
  rows so the deletion time is exact.

Two independent recovery paths (history snapshot + trashed file) back every
delete. See [`review-guide.md`](review-guide.md).

---

## 9. Document export (v1 scope)

Markdown is canonical and LLM-editable. Export is a v1 feature with three routes
(see [`RELEASE.md`](../RELEASE.md) §3 for status and the Pandoc-bundling
decision):

- **HTML** — always available, via the existing remark/rehype pipeline (no
  external dependency).
- **DOCX / PDF** — via Pandoc, **without depending on a user-installed Pandoc**
  (bundle as a sidecar, or detect + fall back). PDF avoids a LaTeX dependency by
  going HTML → webview print-to-PDF.
- **Agent-skill export** — ask the active harness to convert via its built-in
  document skills; doubles as the no-Pandoc fallback.

---

## 10. Engineering principles (the bar)

- **The one perf principle:** anything inside a data-sized loop (per-character,
  per-edit, per-comment, per-row) must be inline arithmetic or pre-built-once
  work — never a per-iteration allocation.
- **Production-grade, not MVP-grade:** do the correct version, delete bad code
  rather than retrofit it, keep modules focused (~400-line trip-wire), follow
  SOLID, own every defect you touch.
- **Verify before done:** `pnpm typecheck && pnpm test && pnpm test:rust &&
  pnpm bench:baseline`, and for user-visible behavior, *drive the packaged
  `.app`* — a passing test does not prove a feature works.

See [`AGENTS.md`](../../AGENTS.md) for the full contributor contract.

---

## 11. Platform & distribution

v1 targets **macOS**. Cross-platform seams exist (the COW clone has a non-macOS
recursive-copy fallback; the index core is portable), but Windows/Linux are not
v1 targets. Distribution requires Developer ID signing + notarization (Apple
Developer Program) and an auto-updater — tracked in [`RELEASE.md`](../RELEASE.md).
