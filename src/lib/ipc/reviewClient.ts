import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";

/**
 * The edit-review gate IPC leaf. After a write-capable harness (Claude /
 * Codex) runs under review, its edits live in a clone sandbox; these
 * commands report what changed, apply an approved change to the real files,
 * and tear the sandbox down. Mirrors `compose::review` + `compose::files::diff`
 * on the Rust side. Desktop-only — the gate only runs for real harness runs.
 */

export type ReviewFileChangeKind = "created" | "modified" | "deleted";

/** One file-level difference between the clone and the live workspace. */
export interface ReviewFileChange {
  relativePath: string;
  kind: ReviewFileChangeKind;
  /** The live file's current text (modified / deleted), when previewable. */
  originalText: string | null;
  /** The clone's proposed text (created / modified), when previewable. */
  newText: string | null;
  /** Binary or too large to inline — show a size-only card, no diff. */
  previewOmitted: boolean;
  /** The live file changed since the run started — accepting overwrites it. */
  stale: boolean;
  originalSize: number;
  newSize: number;
}

/** The file-level changes a finished review run made in its clone sandbox. */
export async function reviewDiff(runId: string): Promise<ReviewFileChange[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<ReviewFileChange[]>("workspace_review_diff", { runId });
}

/**
 * The file-level changes a finished `snapshot`-mode run made directly on the
 * real files, versus its pre-run baseline. Unlike {@link reviewDiff} these are
 * *already applied* — shown as an informational diff in the chat (undo via
 * version history), not a pending accept. Same `ReviewFileChange` shape.
 */
export async function snapshotDiff(runId: string): Promise<ReviewFileChange[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<ReviewFileChange[]>("workspace_snapshot_diff", { runId });
}

/** Apply one approved change to the real workspace (write / create / trash). */
export async function applyReviewChange(runId: string, relativePath: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Reviewing assistant edits requires the desktop runtime.");
  }
  await invoke<void>("workspace_apply_review_change", { runId, relativePath });
}

/** Discard a run's clone sandbox. Safe to call more than once. */
export async function reviewCleanup(runId: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke<void>("workspace_review_cleanup", { runId });
}
