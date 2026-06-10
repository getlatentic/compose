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
| `snapshot` | write-capable harness, review **OFF** (the default) | snapshot a baseline first; the agent edits real files directly, but every edit stays undoable from version history |
| `clone` | write-capable harness, review **ON** (opt-in) | snapshot a baseline, clone the vault, run in the clone, diff + review after |

**Write-capable CLI harnesses run in the real folder by default (`snapshot`).**
`reviewEdits` undefined ⇒ `snapshot`; only an explicit `true` ⇒ `clone`. This is
encoded in `editGuardFor` and is the single source of that policy — change it
there, not in scattered conditionals.

**Why `snapshot` is the default, not `clone`.** A clone runs the agent against a
*copy* in a throwaway temp dir, which is fatal for a CLI agent like Claude/Codex:
it only sees the copy (never the user's real folder), its tools/skills that
target real paths break, and — because Claude Code keys its own session history
by cwd — every run lands under a different `.tmpXXXX` project, so session
continuity and `CLAUDE.md` project memory are lost and its history is littered.
Running in the real folder fixes all of that; the pre-run baseline + version
history is the undo safety net. `clone` (strict pre-approval, agent isolated) is
kept as an opt-in for users who want "nothing touches my files until I approve."

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

### Snapshot storage: compression + retention (`db/snapshot.rs`)

Snapshots accumulate on every write-capable run (baseline + apply), so the blob
column and the row count are both bounded here. All of this lives in
`db/snapshot.rs` so the persistence primitives in `db/mod.rs` stay free of
compression detail; every snapshot-table write goes through
`snapshot::ensure_snapshot_exists`.

- **Compression.** Blobs are deflate-compressed (`flate2`/zlib) on write and
  inflated on read. Each row carries a `codec` tag (`0` raw, `1` zlib) so it is
  self-describing: legacy rows written before compression (the column defaults
  to raw) and rows that don't shrink (tiny files — compression would *grow*
  them past the frame overhead) are stored raw and read back unchanged. The
  decision is "store the smaller of raw vs compressed," so a snapshot is never
  larger than its content. `uncompressed_size` is stored alongside so
  `list_document_versions` reports the original size without inflating
  (`coalesce(uncompressed_size, length(compressed_text))` — the fallback covers
  legacy rows, where the two are equal).
- **The content-hash invariant is preserved.** `content_hash` is still computed
  over the *uncompressed* bytes — it is compared against live-file hashes in
  `current_document_hash` and `unbaselined_paths`. Compression must stay
  invisible to those callers; do not hash the compressed blob.
- **Retention.** After each insert, `prune_document_snapshots` keeps a
  document's newest `SNAPSHOT_RETENTION_LIMIT` (50, matching the version-list UI
  page size) snapshots and deletes the rest — **except** two protected sets that
  survive regardless of age: the document's **latest revision** (the
  restore-to-current anchor, and the snapshot `unbaselined_paths` reads to
  decide a file is already baselined) and any revision the **LLM audit trail**
  (`llm_context_items.document_revision_id`) references. Pruning removes the
  **whole stale unit** — the snapshot blob, the `transactions` row, and the
  `document_revisions` row itself — so per-revision metadata rows stay bounded,
  not just the blobs. (`prune_document_history` iterates every revision, not
  only snapshot-backed ones, so sync-only revisions are bounded too.) Pointers
  that would otherwise dangle into pruned history — a survivor's
  `parent_revision_id`, a transaction's `base_revision_id` — are nulled;
  protected revisions keep their row, snapshot, and transaction intact so the
  audit trail still fully resolves.
- **Interaction with the trash sweep.** `soft_delete` records a deleted file's
  final content as that document's *latest* revision, and retention always
  protects the latest revision — so a soft-deleted file's recovery snapshot is
  never pruned and outlives the `TRASH_RETENTION_DAYS` sweep that eventually
  removes its physical trash copy. This is why count-based retention is safe
  here without a time window keyed to the trash policy; if you ever switch to a
  *time-windowed* history policy, restore that constraint (window ≥
  `TRASH_RETENTION_DAYS`) so history never drops the last recovery path early.
- **Schema migration** mirrors `ensure_conversation_columns`:
  `ensure_snapshot_columns` adds `codec` / `uncompressed_size` in place for DBs
  created before compression. Idempotent; runs on every vault connection.

## Recoverable trash (`files/trash.rs`, `files/trash_sweep.rs`, `db/trash.rs`)

`soft_delete` snapshots the file (so it stays in history), then moves the
physical file to `<app-data>/trash/<vault_id>/<uuid>-<name>` (rename,
copy-then-remove across devices) — **never** an `unlink`. The trash lives
outside any workspace so it never syncs or clutters the vault. There is
intentionally no "empty trash" UI yet.

**Retention sweep.** Soft-deleted files are kept for `TRASH_RETENTION_DAYS`
(30, matching the platform-Trash convention) and then *permanently* removed by a
startup sweep (`files::trash_sweep::run_startup_trash_sweep`, spawned off the
launch thread in `lib.rs` — nothing in the app waits on it). The window is a
constant, not yet user-configurable, and there is no Trash browser — both
deliberately deferred (the product call was "backend sweep only"). When a
settings surface lands, source the window from `app_settings` in
`run_startup_trash_sweep` and pass it through; `sweep_expired_trash` already
takes it as a parameter.

**Why the filesystem can't drive the sweep.** A `rename` preserves the file's
content-mtime (which may be months old for a file deleted today), and the
cross-device copy fallback stamps the copy time — neither is the deletion
moment. So the deletion time is recorded explicitly in a `trash_entries` row
(`db/trash.rs`) in the **global** db (one sweep query spans every vault),
keyed by `vault_id`; the physical file is located by its recorded `trashed_name`.

**The load-bearing invariant: every trashed file has a row.** `soft_delete`
records the `trash_entries` row *before* the physical move (rolling it back if
the move fails), because an orphan file with no row could never be swept and
would leak forever — defeating the growth bound. The sweep is the inverse:
purge the physical file *first*, then delete the row, so a delete that fails
keeps its row and is retried next launch. A missing physical file counts as a
successful purge, so a stale row never wedges the sweep.

**Why permanent deletion here is still safe.** A soft-delete records a history
snapshot *and* moves the physical file — two independent recovery paths.
Purging the trash removes only the second; the file is still restorable from
history via `workspace_restore_version` until snapshot retention prunes it.
**Coherence invariant:** whoever lands snapshot retention (backlog item 1) must
keep its window **≥ `TRASH_RETENTION_DAYS`**, or purging a trashed file could
drop its last recovery path sooner than this window promises.

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

1. **Trash retention is windowed; the UI and configurability are deferred.**
   *Done:* a 30-day startup sweep (`files::trash_sweep`) permanently removes
   files trashed longer ago than `TRASH_RETENTION_DAYS`, tracked by
   `trash_entries` rows so the deletion time is exact (see "Recoverable trash"
   above). *Still open:* the window is a hardcoded constant (no `app_settings`
   wiring or Settings control yet), there is no Trash browser / "empty now" UI,
   and the sweep only runs at launch (a long-running session won't purge until
   restart). All three were a deliberate "backend sweep only" product scope, not
   oversights — the seams (`sweep_expired_trash(retention_days)` param,
   `TrashEntry.original_path` kept for a restore UI) are in place for them.
2. **Pending review is in-memory only.** `ReviewSessionStore` is not persisted;
   quitting mid-review discards the sandbox (real files are safe, but the
   agent's work is lost and must be re-run). Acceptable for a safety gate;
   document if that changes.
3. **Sandbox leak on crash.** A hard crash before `reviewCleanup` leaks the
   temp clone (COW, so ~free disk; the OS reclaims it). A startup sweep of stale
   review sandboxes would close this.
4. **Binary file edits aren't in text history.** Non-UTF-8 files are applied by
   byte copy and not snapshotted, so the undo list doesn't cover them. Fine for
   a markdown app; revisit if binary assets become first-class.

(Snapshot history growth — previously tracked here and cross-referenced from the
trash sweep — is now handled end to end: see *Snapshot storage: compression +
retention* above. Retention compresses blobs and prunes whole stale units
(snapshot + transaction + revision rows), so neither the blobs nor the
per-revision metadata grow without bound.)

## Code map

| Concern | File |
|---|---|
| COW clone | [src-tauri/src/files/clone.rs](../src-tauri/src/files/clone.rs) |
| Tree diff | [src-tauri/src/files/diff.rs](../src-tauri/src/files/diff.rs) |
| Recoverable trash (move / purge / layout) | [src-tauri/src/files/trash.rs](../src-tauri/src/files/trash.rs) |
| Trash retention sweep + `TRASH_RETENTION_DAYS` | [src-tauri/src/files/trash_sweep.rs](../src-tauri/src/files/trash_sweep.rs) |
| `trash_entries` table + queries | [src-tauri/src/db/trash.rs](../src-tauri/src/db/trash.rs) |
| Atomic write / write+record / soft-delete / version commands | [src-tauri/src/files/mod.rs](../src-tauri/src/files/mod.rs) |
| Snapshot list / restore / baseline queries / snapshot backfill | [src-tauri/src/db/history.rs](../src-tauri/src/db/history.rs), [src-tauri/src/db/mod.rs](../src-tauri/src/db/mod.rs) |
| Snapshot blob codec (compression) + retention/pruning | [src-tauri/src/db/snapshot.rs](../src-tauri/src/db/snapshot.rs) |
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
