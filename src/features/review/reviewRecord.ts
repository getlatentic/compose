import { parseFrontmatter } from "@latentic/live-markdown";

import type { ReviewDecisions, WorkspaceAppliedChange, WorkspaceRewriteSuggestion } from "../../app/workspace/types";
import type { FileReview, ReviewMode } from "./liveEdits";

/**
 * One agent rewrite of a note, whichever way it reached the writer: a
 * proposal waiting to be accepted (`pending`) or an edit already made
 * (`applied`). Everything that reviews a rewrite reads it through this.
 */
export interface ReviewRecord {
  readonly id: string;
  readonly filePath: string;
  readonly mode: ReviewMode;
  readonly originalText: string | null;
  readonly newText: string | null;
  readonly previewOmitted: boolean;
  readonly review: ReviewDecisions | undefined;
  /** Rejected as a whole from the chat card: every edit not kept is dropped. */
  readonly wholeRejected: boolean;
}

export function rewriteRecord(suggestion: WorkspaceRewriteSuggestion): ReviewRecord {
  return {
    id: suggestion.id,
    filePath: suggestion.filePath,
    mode: "pending",
    originalText: suggestion.originalText,
    newText: suggestion.newText,
    previewOmitted: suggestion.previewOmitted,
    review: suggestion.review,
    wholeRejected: suggestion.status === "rejected",
  };
}

export function appliedRecord(change: WorkspaceAppliedChange): ReviewRecord {
  return {
    id: change.id,
    filePath: change.filePath,
    mode: "applied",
    originalText: change.originalText,
    newText: change.newText,
    previewOmitted: change.previewOmitted,
    review: change.review,
    wholeRejected: false,
  };
}

/** The editor shows the body only, so the review compares bodies. */
export function reviewBody(markdown: string): string {
  return parseFrontmatter(markdown).body;
}

const NONE: readonly string[] = [];

/** The record as the note's margin reviews it, or null when it has no text to compare. */
export function fileReviewOf(record: ReviewRecord, agentName: string): FileReview | null {
  if (record.previewOmitted || record.originalText === null || record.newText === null) return null;
  return {
    id: record.id,
    mode: record.mode,
    agentName,
    original: reviewBody(record.originalText),
    proposed: reviewBody(record.newText),
    kept: record.review?.kept ?? NONE,
    dropped: record.review?.dropped ?? NONE,
  };
}
