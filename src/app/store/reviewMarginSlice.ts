import { recordReviewDecision, recordReviewFeedbackSent } from "../../features/review/fileReviews";
import type { ReviewFeedback } from "../../features/review/reviewFeedback";
import { markWorkspaceSuggestion } from "../workspaceModel";
import { updateWorkspace } from "./internals";
import { maybeCleanupReview } from "./reviewFlow";
import type { WorkspaceState, WorkspaceStoreGet, WorkspaceStoreSet } from "./types";

export const createReviewMarginSlice = (
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Pick<WorkspaceState, "decideReviewBlock"> => ({
  decideReviewBlock: (reviewId, key, kept) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    const { workspace: decided, settled } = recordReviewDecision(workspace, reviewId, key, kept);
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, () => decided),
    }));
    if (!settled) {
      return;
    }
    // Every block of a pending change is decided in the note: settle the chat's
    // card the same way, and retire the run's sandbox once nothing else waits.
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        markWorkspaceSuggestion(
          item,
          settled.suggestionId,
          settled.anyKept ? "accepted" : "rejected",
          "Reviewed in the note",
          Date.now(),
        ),
      ),
    }));
    maybeCleanupReview(get, workspace.id, settled.runId);
  },
});

/** The prompt carrying `feedback` reached the agent: it is not told again. */
export function markReviewFeedbackSent(
  set: WorkspaceStoreSet,
  workspaceId: string,
  feedback: ReviewFeedback | null,
): void {
  if (!feedback) return;
  set((state) => ({
    workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
      recordReviewFeedbackSent(item, feedback.sent),
    ),
  }));
}
