import type { ReviewDecisions, Workspace, WorkspaceAppliedChange, WorkspaceChatMessage, WorkspaceChatThread, WorkspaceDocumentSuggestion } from "../../app/workspace/types";
import { agentEditKeys } from "./agentEdits";
import type { FileReview } from "./liveEdits";
import { appliedRecord, fileReviewOf, reviewBody, rewriteRecord } from "./reviewRecord";

const NO_DECISIONS: ReviewDecisions = { kept: [], dropped: [], reported: [] };

function messageReviews(message: WorkspaceChatMessage, filePath: string, fallbackAgentName: string): FileReview[] {
  const agentName = message.agentName ?? fallbackAgentName;
  const reviews: (FileReview | null)[] = [];
  for (const suggestion of message.suggestions ?? []) {
    if (suggestion.kind === "rewrite" && suggestion.status === "pending" && suggestion.filePath === filePath) {
      reviews.push(fileReviewOf(rewriteRecord(suggestion), agentName));
    }
  }
  for (const change of message.appliedChanges ?? []) {
    if (change.kind === "rewrite" && change.filePath === filePath) {
      reviews.push(fileReviewOf(appliedRecord(change), agentName));
    }
  }
  return reviews.filter((review): review is FileReview => review !== null);
}

/**
 * Every agent change to `filePath` in the open conversation that can be
 * reviewed in the note, each credited to the agent whose run made it;
 * `fallbackAgentName` names a reply that carries no agent.
 */
export function fileReviewsFor(
  chatThread: WorkspaceChatThread | undefined,
  filePath: string,
  fallbackAgentName: string,
): FileReview[] {
  if (!chatThread || !filePath) return [];
  return chatThread.messages.flatMap((message) => messageReviews(message, filePath, fallbackAgentName));
}

function withDecision(review: ReviewDecisions | undefined, key: string, kept: boolean): ReviewDecisions {
  const current = review ?? NO_DECISIONS;
  const keptWithout = current.kept.filter((existing) => existing !== key);
  const dropped = current.dropped.filter((existing) => existing !== key);
  return kept
    ? { ...current, kept: [...keptWithout, key], dropped }
    : { ...current, kept: keptWithout, dropped: [...dropped, key] };
}

/** True once every edit of the change has a decision. */
function allDecided(
  record: { originalText: string | null; newText: string | null },
  review: ReviewDecisions,
): boolean {
  if (record.originalText === null || record.newText === null) return false;
  const done = new Set([...review.kept, ...review.dropped]);
  return agentEditKeys(reviewBody(record.originalText), reviewBody(record.newText)).every((key) => done.has(key));
}

export interface DecisionResult {
  readonly workspace: Workspace;
  /** A pending suggestion whose edits are now all decided: the caller settles it. */
  readonly settled: { suggestionId: string; runId: string; anyKept: boolean } | null;
}

/**
 * Record that edit `key` of review `reviewId` was kept (the change is in the
 * note) or dropped (it is not). The note itself was already edited by the
 * margin; this only remembers the decision so the edit stops being offered.
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

/** One dropped edit, named by the review it belongs to and its edit key;
 *  `key` is null for a whole new file or deletion the writer rejected. */
export interface ReviewEditRef {
  readonly reviewId: string;
  readonly key: string | null;
}

function withReported(review: ReviewDecisions | undefined, keys: readonly string[]): ReviewDecisions {
  const current = review ?? NO_DECISIONS;
  const fresh = keys.filter((key) => !current.reported.includes(key));
  return fresh.length === 0 ? current : { ...current, reported: [...current.reported, ...fresh] };
}

interface SentIndex {
  readonly keysByReview: ReadonlyMap<string, readonly string[]>;
  readonly wholeFiles: ReadonlySet<string>;
}

function indexSent(sent: readonly ReviewEditRef[]): SentIndex {
  const keysByReview = new Map<string, string[]>();
  const wholeFiles = new Set<string>();
  for (const { reviewId, key } of sent) {
    if (key === null) wholeFiles.add(reviewId);
    else keysByReview.set(reviewId, [...(keysByReview.get(reviewId) ?? []), key]);
  }
  return { keysByReview, wholeFiles };
}

function markSuggestion(suggestion: WorkspaceDocumentSuggestion, index: SentIndex): WorkspaceDocumentSuggestion {
  if (suggestion.kind === "create" || suggestion.kind === "delete") {
    return index.wholeFiles.has(suggestion.id) ? { ...suggestion, rejectionReported: true } : suggestion;
  }
  const keys = index.keysByReview.get(suggestion.id);
  return keys && suggestion.kind === "rewrite" ? { ...suggestion, review: withReported(suggestion.review, keys) } : suggestion;
}

function markAppliedChange(change: WorkspaceAppliedChange, index: SentIndex): WorkspaceAppliedChange {
  const keys = index.keysByReview.get(change.id);
  return keys ? { ...change, review: withReported(change.review, keys) } : change;
}

/** Remember what the agent has been told, so it is told once. */
export function recordReviewFeedbackSent(workspace: Workspace, sent: readonly ReviewEditRef[]): Workspace {
  if (sent.length === 0) return workspace;
  const index = indexSent(sent);
  const messages = workspace.chatThread.messages.map((message) => {
    const suggestions = message.suggestions?.map((suggestion) => markSuggestion(suggestion, index));
    const appliedChanges = message.appliedChanges?.map((change) => markAppliedChange(change, index));
    const changed =
      suggestions?.some((item, i) => item !== message.suggestions?.[i]) ||
      appliedChanges?.some((item, i) => item !== message.appliedChanges?.[i]);
    return changed ? { ...message, suggestions, appliedChanges } : message;
  });
  return { ...workspace, chatThread: { ...workspace.chatThread, messages } };
}
