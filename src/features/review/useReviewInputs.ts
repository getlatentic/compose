import { useEffect, useMemo, useRef } from "react";

import { selectFocusedWorkspace } from "../../app/store/activeWorkspace";
import { useHarnessStore } from "../../app/store/harnessStore";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { fileReviewsFor } from "./fileReviews";
import type { FileReview } from "./liveBlocks";
import { reviewBridge, type MarginComment } from "./reviewBridge";

function sameReview(a: FileReview, b: FileReview): boolean {
  return a.id === b.id && a.agentName === b.agentName && a.decided.length === b.decided.length;
}

/** The agent's name as the chat shows it, for "Claude suggests". */
export function useAgentName(): string {
  return useHarnessStore(
    (state) => state.harnessCatalog.find((harness) => harness.id === state.selectedHarnessId)?.displayName ?? "Assistant",
  );
}

/**
 * Feeds the open note's agent changes and open comments to the editor's
 * review margin. Only a workspace note has a conversation or comments.
 */
export function useReviewInputs(filePath: string, agentName: string): void {
  // Two narrow reads: the workspace object churns on every save.
  const chatThread = useWorkspaceStore((state) =>
    state.focusedArea === "workspace" ? selectFocusedWorkspace(state)?.chatThread : undefined,
  );
  const comments = useWorkspaceStore((state) =>
    state.focusedArea === "workspace" ? selectFocusedWorkspace(state)?.comments : undefined,
  );

  // The thread changes with every streamed token; a review's text never does,
  // so it is the same list until a review or a decision is added.
  const lastReviews = useRef<FileReview[]>([]);
  const reviews = useMemo(() => {
    const next = fileReviewsFor(chatThread, filePath, agentName);
    const same =
      next.length === lastReviews.current.length &&
      next.every((review, index) => sameReview(review, lastReviews.current[index]));
    if (!same) lastReviews.current = next;
    return lastReviews.current;
  }, [chatThread, filePath, agentName]);

  const marginComments = useMemo<MarginComment[]>(
    () =>
      (comments ?? [])
        .filter((comment) => comment.filePath === filePath && comment.status === "open")
        .map((comment) => ({
          id: comment.id,
          body: comment.body,
          selectedText: comment.anchor.selectedText,
          prefix: comment.anchor.prefix,
          suffix: comment.anchor.suffix,
        })),
    [comments, filePath],
  );

  useEffect(() => {
    reviewBridge.setInputs(reviews, marginComments);
  }, [reviews, marginComments]);

  useEffect(() => () => reviewBridge.setInputs([], []), []);
}
