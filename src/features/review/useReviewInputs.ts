import { useEffect, useMemo, useRef } from "react";

import { selectFocusedWorkspace } from "../../app/store/activeWorkspace";
import { harnessDisplayName } from "../../app/store/harnessConfig";
import { useHarnessStore } from "../../app/store/harnessStore";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { fileReviewsFor } from "./fileReviews";
import type { FileReview } from "./liveEdits";
import { setReviewInputs, type MarginComment } from "./reviewBridge";

/** A decision always builds new `kept` and `dropped` lists, so the same lists mean no decision since. */
function sameReview(a: FileReview, b: FileReview): boolean {
  return a.id === b.id && a.mode === b.mode && a.agentName === b.agentName && a.kept === b.kept && a.dropped === b.dropped;
}

/** The selected agent's name: who a comment is sent to, and who wrote a reply that names no agent. */
export function useAgentName(): string {
  return useHarnessStore((state) => harnessDisplayName(state.harnessCatalog, state.selectedHarnessId));
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
    setReviewInputs(reviews, marginComments);
  }, [reviews, marginComments]);

  useEffect(() => () => setReviewInputs([], []), []);
}
