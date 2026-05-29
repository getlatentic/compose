# Editor, text & commenting guide

Read this before touching coordinate conversion, the comment layer
(anchoring / overlap / persistence), the file index, in-document search,
or anything that runs per-keystroke / per-comment / per-row. These paths
have tighter latency budgets than the rest of the app.

## Current architecture (what is wired to what)

The editor is **Tiptap / ProseMirror**
([src/features/editor/TiptapMarkdownEditor.tsx](../src/features/editor/TiptapMarkdownEditor.tsx)).
Tiptap owns the input path, the document model, and rendering — there is
no custom editor renderer or input loop. The Markdown *preview* is
`unified` + `remark` + `rehype` running in a web worker
([src/workers/markdownPipeline.ts](../src/workers/markdownPipeline.ts),
[src/workers/markdown.worker.ts](../src/workers/markdown.worker.ts)).

| Subsystem | Interactive logic (TypeScript) | Backend (Rust via Tauri) |
|---|---|---|
| Editing | Tiptap / ProseMirror | — |
| Markdown preview | unified/remark/rehype in a worker | — |
| Commenting | anchoring, transforms, overlap index — [commentModel.ts](../src/features/comments/commentModel.ts), [commentRangeIndex.ts](../src/features/comments/commentRangeIndex.ts) | `metadata_load_comments` / `metadata_save_comments` → **SQLite** (rusqlite, [src-tauri/src/db/mod.rs](../src-tauri/src/db/mod.rs)) |
| File index | — | `workspace_rebuild_index` / `workspace_index_snapshot` → in-memory `WorkspaceIndexStore` ([src-tauri/src/index/mod.rs](../src-tauri/src/index/mod.rs)), built by the shared `workspace-index` core |
| Search | result-locating inside the Tiptap editor | `workspace_search_index` → `workspace_index::search_snapshot` (case-insensitive substring, UTF-8 byte ranges) |

The split: **TypeScript owns the interactive and coordinate logic; Rust
owns persistence (SQLite) and the file index / search.** Every
`#[tauri::command]` is `async` for the reason in
[ipc-guide.md](ipc-guide.md). Stored comment anchors and search hits
cross the IPC boundary as UTF-8 **byte** ranges; they become DOM/string
positions only at the boundary, through `PositionMapper`.

### Index / search is one Rust core, two targets — never reimplement in TS

The parse / build-snapshot / search logic lives in the pure
[`crates/workspace-index`](../crates/workspace-index) crate (no Tauri, no
filesystem, no SQLite), so it compiles to **both**:

- **native** — `src-tauri`'s index command scans the real folder off
  disk, calls `workspace_index::build_snapshot`, mirrors records into
  SQLite, and caches the snapshot; and
- **WASM** — [`crates/workspace-index-wasm`](../crates/workspace-index-wasm)
  (→ `src/wasm/workspace_index_pkg/`, built by `pnpm build:wasm`) is what
  the **browser** calls. [indexClient.ts](../src/lib/ipc/indexClient.ts)
  routes `!isTauriRuntime()` to the WASM, feeding it the virtual
  workspace's file contents.

So the browser runs the *same Rust* as the desktop — there is **no
TypeScript reimplementation of index/search** (the old
`buildFallbackIndex` / `searchFallbackIndex` are gone). If you change
indexing or search, change it once, in the core crate; do not add a
parallel TS path "just for the browser." `SourceRange` lives in this
crate too (re-exported by `crate::db`), so there is one coordinate type.

(The old `vellum_engine` WASM — a parser/rope engine for the
canvas editor Tiptap replaced — has been removed entirely.)

### Browser files: the virtual workspace (OPFS)

The desktop reads the user's real folder live (Tauri, file watcher). The
browser has no live folder, so it works on a **copy**: a folder is
imported once via `<input webkitdirectory>`
([folderImport.ts](../src/lib/workspace/folderImport.ts)) into a *virtual
workspace* ([virtualWorkspace.ts](../src/lib/workspace/virtualWorkspace.ts))
that `filesClient`'s browser branch delegates to. The store is an
in-memory hot tier (authoritative reads + conflict detection) with a
write-through **OPFS** backend
([workspacePersistence.ts](../src/lib/workspace/workspacePersistence.ts)),
so the workspace survives a reload. The WASM index above runs over this
copy unchanged.

- The persistence backend is **feature-detected**: with no OPFS
  (Node/tests, old browsers) it falls back to a no-op, so the store
  degrades to an ephemeral in-memory Map — which is why
  `filesClient.test.ts` stays green without a browser.
- The browser copy is the source of truth; there is **no write-back** to
  the original folder (the agreed model). An "export to folder" pass
  would be a deliberate future addition.

## Coordinate discipline (spec §6.2)

There is one source of truth for byte ↔ code-unit conversions:
[src/features/text/positionMapper.ts](../src/features/text/positionMapper.ts).
Do not re-derive these conversions elsewhere; do not introduce a parallel
implementation; if you need a new coordinate space (graphemes, line/col)
add it to `PositionMapper`, not to a caller.

- Persisted positions are UTF-8 `ByteOffset`. Comment anchors, edit
  ranges, search hits, index source-ranges, LLM context packets — all
  bytes. SQLite and the Rust index store and return bytes.
- Code-unit indices are for JS string / DOM APIs only, at the boundary,
  transient. They never get persisted and never cross the Tauri IPC
  boundary.
- For >1 conversion on the same text, build a `PositionMapper`. For
  exactly one conversion, the free helpers (`byteLength`,
  `byteOffsetToCodeUnitIndex`, `codeUnitIndexToByteOffset`,
  `sliceByByteRange`) are fine.
- Heavy callers (bulk import, edit batches, anchoring many comments)
  hold the mapper alongside the text snapshot rather than rebuild it per
  call. See `createCommentThread` (which takes a shared `PositionMapper`)
  in [commentModel.ts](../src/features/comments/commentModel.ts) and
  `prepareWorkspaceSuggestionDrafts` in
  [src/app/workspaceModel.ts](../src/app/workspaceModel.ts) for the
  pattern (one mapper per file, threaded through).
- `PositionMapper` construction is O(n) once; every lookup is then
  O(log n) chunk search + bounded intra-chunk walk. The chunk index is
  stored in `Uint32Array`s — no per-character allocations, no GC
  pressure.

## Latency budget over throughput

We aim for "every interaction under one frame, every file size, every
time." When you add a feature that touches the document or the comment
set, decide explicitly whether it runs *before* paint (blocks input) or
*after* (background). If you can't answer, you're about to add lag.

- The visible window is the unit of work, not the document. The comment
  overlay scans only the visible lines (`VISIBLE_LINE_COUNT` in
  [commentOperations.ts](../src/features/benchmark/commentOperations.ts)),
  not every comment against every line — that's what `CommentRangeIndex`
  is for.
- Full-document work (file-index build, workspace search) runs off the
  input thread — in Rust, behind `async` Tauri commands
  ([ipc-guide.md](ipc-guide.md)) — so it never blocks the UI.
- "It finishes eventually" is not a perf claim. The relevant question is
  "does the user wait for it?"

## The lag benchmark is a gate

[src/features/benchmark/lagBenchmark.ts](../src/features/benchmark/lagBenchmark.ts)
captures the operations users feel, across small / large / xlarge
(≈500 KB) documents, and writes the committed report to
[docs/benchmarks/baseline.json](benchmarks/baseline.json) (+ `baseline.md`).
It covers two groups, both live code:

- **Commenting** (the live hot paths): the overlap scan — naive
  `rangeOverlapsAny` vs `CommentRangeIndex.anyOverlapping` — at
  1/10/100/1000 comments, per-edit anchor transforms
  (`applyDocumentChangesToComments`), and bulk comment creation.
- **Coordinate conversion**: `PositionMapper` build + 10k lookups.

Run `pnpm bench:baseline` (it uses
[vitest.bench.config.ts](../vitest.bench.config.ts) — serial, single
fork, and excluded from `pnpm test`) and diff the report before merging
anything that touches coordinates or the comment layer. A regression of
more than ~20% on any p95 needs justification or a rollback; work that
improves the numbers lands the new baseline in the same PR.

**Perf gates live here, not in unit tests.** A wall-clock assertion in a
vitest unit test measures the runner's spare CPU and flakes under load.
Unit tests assert *correctness*; the benchmark owns *latency*. (Two such
assertions — in `commentModel.test.ts` and `positionMapper.test.ts` —
were moved here for exactly this reason.)

## Architectural boundaries that matter

- **Editor = Tiptap / ProseMirror.** Don't reintroduce a custom
  renderer or input loop without an explicit reason.
- **One owner per coord conversion: `PositionMapper`.** Grep before
  introducing a new byte↔code-unit conversion.
- **Persistence is Rust+SQLite; index/search is one Rust core.**
  Comment/metadata persistence is SQLite via Tauri
  ([src-tauri/src/db](../src-tauri/src/db)). Index/search *logic* is the
  pure [`workspace-index`](../crates/workspace-index) crate, run natively
  by the Tauri command and as WASM by the browser — **never reimplement
  it in TS** (see "Index / search is one Rust core" above).
- **Workers exist; use them.** The Markdown preview runs in
  [src/workers/markdown.worker.ts](../src/workers/markdown.worker.ts);
  anything CPU-bound that doesn't need the DOM belongs in a worker (TS)
  or a Rust command.

## Anti-patterns to flag in review

When you see any of these in the comment, coordinate, or index code,
treat it as a perf bug, not a style nit:

- `TextEncoder.encode(x).length` where `x` is a single character or
  comes from inside a loop.
- `byteLength(buffer.content)` called once per iteration of a per-edit
  or per-comment loop. Build a `PositionMapper` and read `.byteLength`.
- `text.slice(0, codeUnit)` to compute a prefix length — that is an
  allocation. Walk forward.
- `new PositionMapper(text)` inside a per-comment / per-row loop. The
  mapper is meant to be hoisted to the outer scope and shared.
- A new full-document scan (overlap, index, lint) added without a
  visible-window-bounded version. If it has to be full-document, it has
  to be off the input thread (worker or Rust command).
- Anything that allocates a `Uint8Array` / object / closure per
  character or per code point.
- A new coordinate type added in a caller instead of in `PositionMapper`.

## What we learned from Sublime (and why it still applies)

Sublime Text's "feels weightless" reputation is not a magic data
structure. It is a team culture of trading engineering effort for
latency, every time, on every feature. The techniques worth keeping in
mind, mapped to *this* codebase:

- One owner of the buffer; no redundant copies. Tiptap/ProseMirror owns
  the live document model, and `PositionMapper` owns coordinates.
- A buffer structure where mid-document edits don't move the rest of the
  file — ProseMirror's document model provides this for the live editor.
- Lazy work bounded by the visible window plus a small over-scan — the
  comment overlay scan.
- Always-on cheap work + opt-in expensive pass — cheap per-paint overlap
  via the index; the expensive full-file index/search is a background
  Rust command.
- Preallocated scratch buffers in hot paths. We have no `mmap` and no
  manual GC, so the discipline is: type the scratch as `Uint32Array` /
  `Uint8Array`, allocate it once, never per-iteration. See the
  `maxEndUpTo` array in `CommentRangeIndex`.

The honest meta-lesson: every team starts wanting weightless interaction
and most trade it away for features — a linter that scans the whole
file, a symbol index that holds the whole AST, a second renderer in the
process. Those trades feel small individually and lethal cumulatively.
This guide's job is to make the trades visible while they are still cheap
to reverse.
