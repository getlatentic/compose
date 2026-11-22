import type {
  ReviewDecisions,
  WorkspaceAppliedChange,
  WorkspaceChatThread,
  WorkspaceRewriteSuggestion,
} from "../../app/workspaceModel";
import { blockKeys, changeBlocks, type ChangeBlock } from "./changeBlocks";
import { reviewBody, type ReviewBlockRef } from "./fileReviews";
import { wordDiff, type WordSegment } from "./wordDiff";

/**
 * What the writer took back out of the agent's edits since the agent last
 * heard about it, as a note for the next prompt. Without it the agent sees
 * its edit missing on the next turn, takes it for its own mistake, and
 * makes it again.
 */
export interface ReviewFeedback {
  readonly note: string;
  /** The blocks the note tells of: record them once the prompt is sent. */
  readonly sent: readonly ReviewBlockRef[];
}

/** Blocks named one by one; the rest are counted. */
const MAX_LISTED_BLOCKS = 12;
/** Word changes described per block. */
const MAX_PHRASES_PER_BLOCK = 3;
const MAX_QUOTE_CHARS = 80;
const CONTEXT_WORDS = 3;

type Verb = "undid" | "rejected";

interface DroppedBlock {
  readonly ref: ReviewBlockRef;
  readonly filePath: string;
  readonly verb: Verb;
  readonly block: ChangeBlock;
}

interface ReviewRecord {
  readonly id: string;
  readonly filePath: string;
  readonly verb: Verb;
  readonly originalText: string | null;
  readonly newText: string | null;
  readonly previewOmitted: boolean;
  readonly review: ReviewDecisions | undefined;
  /** Rejected as a whole from the chat card: every block not kept is dropped. */
  readonly wholeRejected: boolean;
}

function fromSuggestion(suggestion: WorkspaceRewriteSuggestion): ReviewRecord {
  return {
    id: suggestion.id,
    filePath: suggestion.filePath,
    verb: "rejected",
    originalText: suggestion.originalText,
    newText: suggestion.newText,
    previewOmitted: suggestion.previewOmitted,
    review: suggestion.review,
    wholeRejected: suggestion.status === "rejected",
  };
}

function fromAppliedChange(change: WorkspaceAppliedChange): ReviewRecord {
  return {
    id: change.id,
    filePath: change.filePath,
    verb: "undid",
    originalText: change.originalText,
    newText: change.newText,
    previewOmitted: change.previewOmitted,
    review: change.review,
    wholeRejected: false,
  };
}

function reviewRecords(thread: WorkspaceChatThread): ReviewRecord[] {
  return thread.messages.flatMap((message) => [
    ...(message.suggestions ?? [])
      .filter((suggestion): suggestion is WorkspaceRewriteSuggestion => suggestion.kind === "rewrite")
      .map(fromSuggestion),
    ...(message.appliedChanges ?? []).filter((change) => change.kind === "rewrite").map(fromAppliedChange),
  ]);
}

function unreportedDrops(record: ReviewRecord): DroppedBlock[] {
  if (record.previewOmitted || record.originalText === null || record.newText === null) return [];
  const kept = new Set(record.review?.kept ?? []);
  const dropped = new Set(record.review?.dropped ?? []);
  const reported = new Set(record.review?.reported ?? []);
  const blocks = changeBlocks(reviewBody(record.originalText), reviewBody(record.newText));
  const keys = blockKeys(blocks);
  return blocks.flatMap((block, index) => {
    const key = keys[index];
    const isDropped = dropped.has(key) || (record.wholeRejected && !kept.has(key));
    if (!isDropped || reported.has(key)) return [];
    return [{ ref: { reviewId: record.id, key }, filePath: record.filePath, verb: record.verb, block }];
  });
}

function quote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const short = flat.length > MAX_QUOTE_CHARS ? `${flat.slice(0, MAX_QUOTE_CHARS - 1).trimEnd()}…` : flat;
  return `"${short}"`;
}

function trailingWords(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(-CONTEXT_WORDS).join(" ");
}

/** "added "(2006)" after "Braun and Clarke"", from the agent's side. */
function phrase(removed: string, added: string, before: string): string {
  const change = !removed.trim()
    ? `added ${quote(added)}`
    : !added.trim()
      ? `deleted ${quote(removed)}`
      : `replaced ${quote(removed)} with ${quote(added)}`;
  const context = trailingWords(before);
  return context ? `${change} after ${quote(context)}` : change;
}

function blockPhrases(block: ChangeBlock): string[] {
  const segments: readonly WordSegment[] = wordDiff(block.removed.join("\n"), block.added.join("\n"));
  const phrases: string[] = [];
  let before = "";
  let removed = "";
  let added = "";
  const flush = () => {
    if (removed.trim() || added.trim()) phrases.push(phrase(removed, added, before));
    removed = "";
    added = "";
  };
  for (const segment of segments) {
    if (segment.kind === "same") {
      flush();
      before = segment.text;
    } else if (segment.kind === "removed") {
      removed += segment.text;
    } else {
      added += segment.text;
    }
  }
  flush();
  if (phrases.length > MAX_PHRASES_PER_BLOCK) {
    return [...phrases.slice(0, MAX_PHRASES_PER_BLOCK), "and more in the same passage"];
  }
  return phrases;
}

function describeDrop(drop: DroppedBlock): string {
  return `- The writer ${drop.verb} your change to \`${drop.filePath}\`: you had ${blockPhrases(drop.block).join("; ")}.`;
}

/** The note for the agent's next prompt, or null when nothing was undone or rejected since it last heard. */
export function reviewFeedbackFor(thread: WorkspaceChatThread): ReviewFeedback | null {
  const drops = reviewRecords(thread).flatMap(unreportedDrops);
  if (drops.length === 0) return null;
  const listed = drops.slice(0, MAX_LISTED_BLOCKS).map(describeDrop);
  const unlisted = drops.length - listed.length;
  const lines = [
    "Since your last turn the writer took some of your edits back out:",
    ...listed,
    ...(unlisted > 0 ? [`- …and ${unlisted} more of your changes the writer undid or rejected.`] : []),
    "These are not in the notes now on purpose. Leave them out unless the writer asks for them.",
  ];
  return { note: lines.join("\n"), sent: drops.map((drop) => drop.ref) };
}

/** The user's message with the review note in front of it. */
export function withReviewFeedback(prompt: string, feedback: ReviewFeedback | null): string {
  return feedback ? `${feedback.note}\n\n${prompt}` : prompt;
}
