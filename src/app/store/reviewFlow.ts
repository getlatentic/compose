import {
  applyReviewChange,
  reviewCleanup,
  reviewDiff,
  snapshotDiff,
  type ReviewFileChange,
} from "../../lib/ipc/reviewClient";
import type { EditGuard } from "../../lib/ipc/harnessClient";
import {
  appendAppliedChanges,
  appendReviewChangeSuggestions,
  applyScanResult,
  markWorkspaceSuggestion,
  type Workspace,
  type WorkspaceDocumentSuggestion,
  type WorkspaceReviewSuggestionDraft,
} from "../workspaceModel";
import { scanWorkspace } from "../../lib/ipc/filesClient";
import { errorMessage, updateWorkspace } from "./internals";
import type { WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { showErrorToast } from "../../features/toast/toastStore";

/** Map a clone-diff file change into a pending review suggestion draft. */
export function reviewChangeToDraft(change: ReviewFileChange): WorkspaceReviewSuggestionDraft {
  const kind =
    change.kind === "created" ? "create" : change.kind === "deleted" ? "delete" : "rewrite";
  return {
    kind,
    filePath: change.relativePath,
    originalText: change.originalText,
    newText: change.newText,
    originalSize: change.originalSize,
    newSize: change.newSize,
    previewOmitted: change.previewOmitted,
    stale: change.stale,
  };
}

/** Find a suggestion by id across a workspace's chat messages. */
export function findWorkspaceSuggestion(
  workspace: Workspace,
  suggestionId: string,
): WorkspaceDocumentSuggestion | null {
  for (const message of workspace.chatThread.messages) {
    const found = message.suggestions?.find((suggestion) => suggestion.id === suggestionId);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Count still-pending file-level (clone-gate) suggestions for a run. */
function pendingReviewSuggestionCount(workspace: Workspace, runId: string): number {
  let count = 0;
  for (const message of workspace.chatThread.messages) {
    for (const suggestion of message.suggestions ?? []) {
      if (
        suggestion.runId === runId &&
        suggestion.kind !== "replace" &&
        suggestion.status === "pending"
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/** Discard a run's review sandbox once no file-level changes remain pending. */
export function maybeCleanupReview(get: WorkspaceStoreGet, workspaceId: string, runId: string) {
  const workspace = get().workspaces.find((item) => item.id === workspaceId);
  if (workspace && pendingReviewSuggestionCount(workspace, runId) === 0) {
    void reviewCleanup(runId).catch(() => {
      // best-effort — the sandbox is a temp dir the OS reclaims anyway
    });
  }
}

/**
 * After an edit-guarded run finishes, surface what it changed in the chat:
 *  - `clone`: diff the sandbox against the live workspace and attach the
 *    changes as **pending** accept/reject suggestions (nothing has touched the
 *    real files yet);
 *  - `snapshot`: the agent already edited the real files, so diff the pre-run
 *    baseline against them and attach the changes as **informational** applied
 *    diffs (undo via version history).
 * A cancelled run, an empty diff, or a diff failure tears the run's review
 * state down instead. `none` (bob / read-only) does nothing.
 */
export async function finishReviewRun(
  set: WorkspaceStoreSet,
  workspaceId: string,
  runId: string,
  editGuard: EditGuard,
  cancelled: boolean,
): Promise<void> {
  if (editGuard === "clone") {
    await finishCloneReview(set, workspaceId, runId, cancelled);
  } else if (editGuard === "snapshot") {
    await finishSnapshotReview(set, workspaceId, runId, cancelled);
  }
}

/** Clone gate: real files untouched mid-run; the diff becomes pending edits. */
async function finishCloneReview(
  set: WorkspaceStoreSet,
  workspaceId: string,
  runId: string,
  cancelled: boolean,
): Promise<void> {
  if (cancelled) {
    await reviewCleanup(runId).catch(() => {});
    return;
  }
  let changes: ReviewFileChange[];
  try {
    changes = await reviewDiff(runId);
  } catch (error) {
    showErrorToast(errorMessage(error, "Could not compare the assistant's changes"));
    await reviewCleanup(runId).catch(() => {});
    return;
  }
  if (changes.length === 0) {
    await reviewCleanup(runId).catch(() => {});
    return;
  }
  const drafts = changes.map(reviewChangeToDraft);
  set((state) => ({
    workspaces: updateWorkspace(state.workspaces, workspaceId, (workspace) => ({
      ...workspace,
      chatThread: appendReviewChangeSuggestions(workspace.chatThread, runId, drafts, Date.now()),
    })),
  }));
}

/**
 * Snapshot mode: the agent already edited the real files. Diff the pre-run
 * baseline against them and show the result as informational applied changes.
 * The baseline is freed once read. A diff failure is silent — the edits have
 * landed regardless, so there is no safety action to prompt; we just can't draw
 * the diff. (No-op in the browser, where `snapshotDiff` returns `[]`.)
 */
async function finishSnapshotReview(
  set: WorkspaceStoreSet,
  workspaceId: string,
  runId: string,
  cancelled: boolean,
): Promise<void> {
  if (cancelled) {
    await reviewCleanup(runId).catch(() => {});
    return;
  }
  let changes: ReviewFileChange[];
  try {
    changes = await snapshotDiff(runId);
  } catch {
    await reviewCleanup(runId).catch(() => {});
    return;
  }
  await reviewCleanup(runId).catch(() => {});
  if (changes.length === 0) {
    return;
  }
  const drafts = changes.map(reviewChangeToDraft);
  set((state) => ({
    workspaces: updateWorkspace(state.workspaces, workspaceId, (workspace) => ({
      ...workspace,
      chatThread: appendAppliedChanges(workspace.chatThread, runId, drafts),
    })),
  }));
}

/**
 * Apply one approved file-level change to disk through the run's review
 * session, then record the outcome on its suggestion (accepted, or stale if
 * the file moved under us). Tears the sandbox down once nothing is pending.
 */
export async function applyFileReviewChange(
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
  workspaceId: string,
  suggestion: WorkspaceDocumentSuggestion,
): Promise<void> {
  try {
    await applyReviewChange(suggestion.runId, suggestion.filePath);
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, (workspace) =>
        markWorkspaceSuggestion(workspace, suggestion.id, "accepted", null, Date.now()),
      ),
    }));
    // The fs watcher also fires, but it's async, debounced, and best-effort —
    // a newly *created* file otherwise wouldn't show in the tree until a
    // reload. Rescan deterministically on accept so it appears at once.
    try {
      const entries = await scanWorkspace(workspaceId);
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspaceId, (workspace) =>
          applyScanResult(workspace, entries),
        ),
      }));
    } catch {
      // best-effort — the watcher remains the backstop
    }
  } catch (error) {
    const message = errorMessage(error, "Could not apply this change");
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, (workspace) =>
        markWorkspaceSuggestion(workspace, suggestion.id, "stale", message, Date.now()),
      ),
    }));
  }
  maybeCleanupReview(get, workspaceId, suggestion.runId);
}
