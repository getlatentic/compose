import { parseFrontmatter } from "@latentic/live-markdown";

import type {
  ReviewDecisions,
  Workspace,
  WorkspaceAppliedChange,
  WorkspaceChatMessage,
  WorkspaceChatThread,
  WorkspaceRewriteSuggestion,
} from "../../app/workspaceModel";
import { reviewBlockKeys, type FileReview } from "./liveBlocks";

const NO_DECISIONS: ReviewDecisions = { kept: [], dropped: [] };

/** The editor shows the body only, so the review compares bodies. */
function body(markdown: string): string {
  return parseFrontmatter(markdown).body;
}

function decided(review: ReviewDecisions | undefined): string[] {
  const { kept, dropped } = review ?? NO_DECISIONS;
  return [...kept, ...dropped];
}

function fromSuggestion(suggestion: WorkspaceRewriteSuggestion, agentName: string): FileReview | null {
  if (suggestion.status !== "pending" || suggestion.previewOmitted) return null;
  if (suggestion.originalText === null || suggestion.newText === null) return null;
  return {
    id: suggestion.id,
    mode: "pending",
    agentName,
    original: body(suggestion.originalText),
    proposed: body(suggestion.newText),
    decided: decided(suggestion.review),
  };
}

function fromAppliedChange(change: WorkspaceAppliedChange, agentName: string): FileReview | null {
  if (change.kind !== "rewrite" || change.previewOmitted) return null;
  if (change.originalText === null || change.newText === null) return null;
  return {
    id: change.id,
    mode: "applied",
    agentName,
    original: body(change.originalText),
    proposed: body(change.newText),
    decided: decided(change.review),
  };
}

function messageReviews(message: WorkspaceChatMessage, filePath: string, agentName: string): FileReview[] {
  const reviews: (FileReview | null)[] = [];
  for (const suggestion of message.suggestions ?? []) {
    if (suggestion.kind === "rewrite" && suggestion.filePath === filePath) {
      reviews.push(fromSuggestion(suggestion, agentName));
    }
  }
  for (const change of message.appliedChanges ?? []) {
    if (change.filePath === filePath) {
      reviews.push(fromAppliedChange(change, agentName));
    }
  }
  return reviews.filter((review): review is FileReview => review !== null);
}

/** Every agent change to `filePath` in the open conversation that can be reviewed in the note. */
export function fileReviewsFor(chatThread: WorkspaceChatThread | undefined, filePath: string, agentName: string): FileReview[] {
  if (!chatThread || !filePath) return [];
  return chatThread.messages.flatMap((message) => messageReviews(message, filePath, agentName));
}

function withDecision(review: ReviewDecisions | undefined, key: string, kept: boolean): ReviewDecisions {
  const current = review ?? NO_DECISIONS;
  const keptWithout = current.kept.filter((existing) => existing !== key);
  const dropped = current.dropped.filter((existing) => existing !== key);
  return kept ? { kept: [...keptWithout, key], dropped } : { kept: keptWithout, dropped: [...dropped, key] };
}

/** True once every block of the change has a decision. */
function allDecided(
  record: { originalText: string | null; newText: string | null },
  review: ReviewDecisions,
): boolean {
  if (record.originalText === null || record.newText === null) return false;
  const done = new Set([...review.kept, ...review.dropped]);
  return reviewBlockKeys({ original: body(record.originalText), proposed: body(record.newText) }).every((key) =>
    done.has(key),
  );
}

export interface DecisionResult {
  readonly workspace: Workspace;
  /** A pending suggestion whose blocks are now all decided: the caller settles it. */
  readonly settled: { suggestionId: string; runId: string; anyKept: boolean } | null;
}

/**
 * Record that block `key` of review `reviewId` was kept (the change is in the
 * note) or dropped (it is not). The note itself was already edited by the
 * margin; this only remembers the decision so the block stops being offered.
 */
export function recordReviewDecision(workspace: Workspace, reviewId: string, key: string, kept: boolean): DecisionResult {
  let settled: DecisionResult["settled"] = null;
  const messages = workspace.chatThread.messages.map((message) => {
    let changed = false;
    const suggestions = message.suggestions?.map((suggestion) => {
      if (suggestion.id !== reviewId || suggestion.kind !== "rewrite") return suggestion;
      changed = true;
      const review = withDecision(suggestion.review, key, kept);
      if (allDecided(suggestion, review)) {
        settled = { suggestionId: suggestion.id, runId: suggestion.runId, anyKept: review.kept.length > 0 };
      }
      return { ...suggestion, review };
    });
    const appliedChanges = message.appliedChanges?.map((change) => {
      if (change.id !== reviewId) return change;
      changed = true;
      return { ...change, review: withDecision(change.review, key, kept) };
    });
    return changed ? { ...message, suggestions, appliedChanges } : message;
  });
  return { workspace: { ...workspace, chatThread: { ...workspace.chatThread, messages } }, settled };
}
