# Edit-review gate + git-free version history guide

Read this before touching the clone/diff/apply path, the `EditGuard` flow,
the document-snapshot history, or the recoverable trash. These paths decide
whether an AI's edits reach the user's real files, and whether a change can be
undone — getting them subtly wrong is either a data-loss bug or a broken
safety promise, neither of which a unit test always catches.

## Why this exists

bob proposes **previewable** edits: a `suggestedEdits` event →
`WorkspaceDocumentSuggestion` → the user accepts/rejects in `SuggestionList` →
applied by byte-range. Claude / Codex do not — they write to the user's files
**directly** through their own Edit/Write tools (`previews_edits: false`). For a
non-technical user that means an agent's changes land with no review and no
undo. This subsystem closes that gap for *every* harness:

- **Clone gate** — run the agent against a copy; the user approves the diff
  before anything touches their files.
- **Git-free undo** — a per-file "Previous versions" list backed by SQLite
  snapshots, never git (many users have no git and don't understand commits).

Files are the source of truth. SQLite is a sidecar (history / metadata), never
the authority on content.

## The one decision the whole thing hangs on: `EditGuard`

Every run resolves to one of three modes, chosen on the **frontend** from
capabilities + the user's toggle (`editGuardFor` in
[src/app/workspaceStore.ts](../src/app/workspaceStore.ts)), sent on
`HarnessRunRequest.editGuard`, and acted on by the **backend**
([src-tauri/src/review/mod.rs](../src-tauri/src/review/mod.rs)):

| Mode | When | Backend behavior |
|---|---|---|
| `none` | harness previews its own edits (bob), or a read-only plan/ask run | nothing — bob's `suggestedEdits` path is unchanged |
| `clone` | write-capable harness, review **ON** (the default) | snapshot a baseline, clone the vault, run in the clone, diff + review after |
| `snapshot` | write-capable harness, review **OFF** | snapshot a baseline first; the agent edits real files directly, but every edit stays undoable |

**Review is ON by default for write-capable harnesses.** `reviewEdits`
undefined ⇒ `clone`; only an explicit `false` ⇒ `snapshot`. This is encoded in
`editGuardFor` and is the single source of that policy — change it there, not
in scattered conditionals.

**The gate is the non-bob path only.** bob previews + records its own edits via
`workspace_write_file`, so it needs neither a clone nor a baseline. The entire
gate lives behind `run_via_harness`; `prepare_bob_spawn` is untouched. Do not
reintroduce the gate into the bob path.

**Capability-driven, never id checks.** `editGuardFor` reads
`HarnessCapabilities.previewsEdits`. A new write-capable harness gets the gate
for free; a `harnessId === "bob"` literal here is exactly the regression this
design exists to prevent.

## The clone (`files/clone.rs`)

`clone_workspace(src, dst)` mirrors the vault into a temp dir, **copy-on-write
per file** via `clonefile(2)` on macOS/APFS (instant, ~no extra disk), with a
recursive byte-copy fallback elsewhere. Two invariants:

- **Ignore rules at every level.** It honors `is_ignored_segment`
  (`.git` / `node_modules` / `target` / `dist` + dotfiles) recursively, not
  just at the top level. (An early version COW-cloned whole directories and
  dragged nested `.cache` dirs along — that's why the walk is per-file.)
- **Symlinks are skipped, never followed.** A clone must never reach outside
  itself.

The clone lives in the OS temp dir, **outside the watched workspace root**, so
the file watcher never fires on the agent's in-clone edits — that is what makes
the real editor stay still mid-run (no flicker). Do not move the clone inside
the vault.

## The single cwd seam

Both bob and the generic harness derive their working directory from
`registry.workspace_root(workspace_id)` in
[src-tauri/src/bob/runner.rs](../src-tauri/src/bob/runner.rs). The gate
intercepts exactly one place: `run_via_harness` calls
`review::prepare_edit_guard(...)`, which returns the clone path for `clone`
mode and the real root otherwise. That returned `PathBuf` becomes
`RunRequest.cwd`. If you add another run entry point, route its cwd through
`prepare_edit_guard` too — do not resolve `workspace_root` directly for an
edit-capable run.

## Diff → review → apply (`files/diff.rs`, `review/mod.rs`)

After a `clone` run's terminal `exited` event, the store's `onFinished` hook →
`finishReviewRun` → `workspace_review_diff(runId)`:

1. `diff_workspace(clone_root, real_root)` walks both trees and compares by
   **SHA-256 content hash** → `created` / `modified` / `deleted` `FileChange`s,
   each with size/UTF-8-guarded inline content for the preview
   (`MAX_PREVIEW_BYTES`; binary or oversized ⇒ `previewOmitted`, size-only card).
2. The review command flags `stale` per change by comparing the real file's
   current hash to the pre-run baseline (`current_document_hash`) — i.e. the
   user edited it *during* the run; accepting would overwrite their edit.
3. Changes become file-level `WorkspaceDocumentSuggestion`s
   (`kind: create | rewrite | delete`) and feed the **same** `SuggestionList` as
   bob's `replace` kind (one discriminated union, one UI).

Accept (`apply_review_change`) re-derives the action from the clone's current
state (a stale request can't apply the wrong op), writes the clone's content to
the real file atomically (`write_and_record` → snapshot), or soft-deletes
(`soft_delete` → trash). The sandbox is torn down (`reviewCleanup`) when the
last pending change for the run is resolved, on cancel, on empty diff, or on
diff failure (`maybeCleanupReview` / `finishReviewRun`).

**Why a full-vault hash and not an mtime shortcut.** A missed change = an
unreviewed edit landing on the user's files, which defeats the entire feature.
Hashing both trees is O(vault) but it is *correct* — it never misses. It runs
post-run, off the UI thread, while the user reads the agent's summary, and is
sub-second for the markdown vaults this product targets. Do not "optimize" it
into mtime comparison without a correctness argument for why a same-mtime write
can't happen.

## Git-free version history (`db/history.rs`, `db/mod.rs`)

A document **revision** is metadata (hash, parent, timestamp); a **snapshot**
is the full content blob for a revision. Restorability requires a *snapshot*,
not just a revision — and `sync_documents` (a plain scan) records revisions
with **no** snapshot.

**The load-bearing invariant:** `record_revision_if_needed` guarantees a
snapshot blob exists whenever content is handed in, *even when the hash matches
a prior snapshot-less revision* (`ensure_snapshot_exists`). Before this fix,
`record_document_written` could no-op against a scan-only revision and leave
"Previous versions" with revisions that had nothing to restore. The baseline
pass and undo correctness both depend on this — do not re-introduce an
early-return that skips the snapshot.

- **Baseline** (`review::snapshot_baseline`): before an edit-capable run,
  snapshot the current content of every markdown file that isn't already
  snapshotted. Bounded by `MetadataStore::unbaselined_paths` (a stat-level
  mtime/size + has-current-snapshot check), so steady-state runs only re-read
  genuinely-changed files. This baseline is the undo point *and* the stale
  reference.
- **List / restore**: `workspace_list_versions` (newest-first, with `isCurrent`
  computed from the live file's hash) and `workspace_restore_version`, which
  snapshots the *current* content first so a restore is itself undoable, then
  writes the chosen version back via `write_and_record`. Restoring a
  soft-deleted file recreates it.

## Recoverable trash (`files/trash.rs`)

`soft_delete` snapshots the file (so it stays in history), then `move_to_trash`
moves the physical file to `<app-data>/trash/<vault_id>/<uuid>-<name>`
(rename, copy-then-remove across devices) — **never** an `unlink`. The trash
lives outside any workspace so it never syncs or clutters the vault. There is
intentionally no "empty trash" UI in v1.

## Invariants to defend in review

- Real files are untouched until the user accepts (clone mode). Verify by
  watching the real file on disk during a run.
- bob's `suggestedEdits` path is unchanged; the gate is non-bob only.
- One accept/reject UI (`SuggestionList`) for all `kind`s; one history dialog.
- Soft-delete only; `write_file_atomic` for every write that lands on a real
  file (temp + rename in the same dir — the LibreOffice pattern).
- Capabilities, not harness ids.

## Performance characteristics (be honest about these)

For the target domain — personal markdown vaults, MBs to tens of MBs — every
operation here is fast: COW clone is O(1); the pre-run baseline (bounded by
changed files) and the post-run diff (full hash) are off-thread and sub-second.
They are **O(vault), not weightless**: a pathological multi-GB vault would see a
noticeable post-run pause. That is an accepted trade — correctness (never miss a
change) over micro-optimizing a scale outside the product's domain — but if the
domain ever grows to giant repos, the diff is where to bound work first (and
`log()` anything you drop; never silently truncate a safety diff).

## Known limitations / hardening backlog

These work correctly today but are real "operate for years at scale" gaps —
treat them as follow-ups, not done:

1. **Snapshot history grows unbounded and uncompressed.** `document_snapshots`
   stores full raw bytes (the `compressed_text` column name is aspirational —
   compression was never implemented), and nothing prunes old revisions. The
   baseline + apply paths add snapshots on every run, accelerating growth.
   Needs a retention policy (keep last N / time-windowed) + compression, taking
   care not to prune a revision referenced by `llm_context_items`.
2. **Trash grows unbounded.** Deleted files accumulate in `<app-data>/trash`
   forever. Needs a retention policy — but that means *permanently* deleting
   user data, so it's a deliberate product decision, not a silent default.
3. **Pending review is in-memory only.** `ReviewSessionStore` is not persisted;
   quitting mid-review discards the sandbox (real files are safe, but the
   agent's work is lost and must be re-run). Acceptable for a safety gate;
   document if that changes.
4. **Sandbox leak on crash.** A hard crash before `reviewCleanup` leaks the
   temp clone (COW, so ~free disk; the OS reclaims it). A startup sweep of stale
   review sandboxes would close this.
5. **Binary file edits aren't in text history.** Non-UTF-8 files are applied by
   byte copy and not snapshotted, so the undo list doesn't cover them. Fine for
   a markdown app; revisit if binary assets become first-class.

## Code map

| Concern | File |
|---|---|
| COW clone | [src-tauri/src/files/clone.rs](../src-tauri/src/files/clone.rs) |
| Tree diff | [src-tauri/src/files/diff.rs](../src-tauri/src/files/diff.rs) |
| Recoverable trash | [src-tauri/src/files/trash.rs](../src-tauri/src/files/trash.rs) |
| Atomic write / write+record / soft-delete / version commands | [src-tauri/src/files/mod.rs](../src-tauri/src/files/mod.rs) |
| Snapshot list / restore / baseline queries / snapshot backfill | [src-tauri/src/db/history.rs](../src-tauri/src/db/history.rs), [src-tauri/src/db/mod.rs](../src-tauri/src/db/mod.rs) |
| Review session, EditGuard, clone+diff+apply orchestration | [src-tauri/src/review/mod.rs](../src-tauri/src/review/mod.rs) |
| cwd seam, `edit_guard` request field | [src-tauri/src/bob/runner.rs](../src-tauri/src/bob/runner.rs) |
| Suggestion union, append/accept/mark | [src/app/workspaceModel.ts](../src/app/workspaceModel.ts) |
| `editGuardFor`, post-run diff orchestration, accept/reject | [src/app/workspaceStore.ts](../src/app/workspaceStore.ts) |
| IPC leaves | [src/lib/ipc/reviewClient.ts](../src/lib/ipc/reviewClient.ts), [src/lib/ipc/historyClient.ts](../src/lib/ipc/historyClient.ts) |
| UI: cards / toggle / version dialog | [src/features/chat/SuggestionList.tsx](../src/features/chat/SuggestionList.tsx), [src/features/settings/SettingsPanel.tsx](../src/features/settings/SettingsPanel.tsx), [src/features/history/VersionHistory.tsx](../src/features/history/VersionHistory.tsx) |

## Verifying a change here

`cargo test -p compose` and `pnpm test` cover the logic, but the safety promise
is only proven by **driving the packaged `.app`**: send a write-capable harness
an edit, confirm on disk that the real file is unchanged mid-run while a clone
sandbox holds the edit, then accept and confirm the real file updates and the
sandbox is removed. A passing unit test does not prove a real file stayed
untouched.
