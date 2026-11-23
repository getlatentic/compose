import type { WorkspaceChatMessage, WorkspaceChatThread, WorkspaceCreateSuggestion, WorkspaceDeleteSuggestion, WorkspaceDocumentSuggestion } from "../../app/workspace/types";
import { agentBlocks, type AgentEdit } from "./agentEdits";
import type { ReviewEditRef } from "./fileReviews";
import { appliedRecord, reviewBody, rewriteRecord, type ReviewRecord } from "./reviewRecord";

/**
 * What the writer took back out of the agent's edits since the agent last
 * heard about it, as a note for the next prompt. Without it the agent sees
 * its edit missing on the next turn, takes it for its own mistake, and
 * makes it again.
 */
export interface ReviewFeedback {
  readonly note: string;
  /** The edits the note tells of: record them once the prompt is sent. */
  readonly sent: readonly ReviewEditRef[];
}

/** Changes named one by one; the rest are counted. */
const MAX_LISTED_CHANGES = 12;
const MAX_QUOTE_CHARS = 80;
const CONTEXT_WORDS = 3;

type Verb = "undid" | "rejected";

/** One change the agent is told of, described only if it is listed. */
interface FeedbackItem {
  readonly ref: ReviewEditRef;
  readonly describe: () => string;
}

interface DroppedEdit {
  readonly ref: ReviewEditRef;
  readonly filePath: string;
  readonly verb: Verb;
  readonly edit: AgentEdit;
}

/** A new file or a deletion the writer turned down from the chat card. */
function fileRejection(suggestion: WorkspaceCreateSuggestion | WorkspaceDeleteSuggestion): FeedbackItem[] {
  if (suggestion.status !== "rejected" || suggestion.rejectionReported) return [];
  const path = `\`${suggestion.filePath}\``;
  const line =
    suggestion.kind === "create"
      ? `- The writer rejected the new file you made, ${path}. It does not exist.`
      : `- The writer rejected your deletion of ${path}. The file is still there.`;
  return [{ ref: { reviewId: suggestion.id, key: null }, describe: () => line }];
}

function editItems(record: ReviewRecord): FeedbackItem[] {
  return unreportedDrops(record).map((drop) => ({ ref: drop.ref, describe: () => describeDrop(drop) }));
}

function suggestionItems(suggestion: WorkspaceDocumentSuggestion): FeedbackItem[] {
  if (suggestion.kind === "rewrite") return editItems(rewriteRecord(suggestion));
  if (suggestion.kind === "create" || suggestion.kind === "delete") return fileRejection(suggestion);
  return [];
}

function messageItems(message: WorkspaceChatMessage): FeedbackItem[] {
  return [
    ...(message.suggestions ?? []).flatMap(suggestionItems),
    ...(message.appliedChanges ?? [])
      .filter((change) => change.kind === "rewrite")
      .flatMap((change) => editItems(appliedRecord(change))),
  ];
}

function unreportedDrops(record: ReviewRecord): DroppedEdit[] {
  if (record.previewOmitted || record.originalText === null || record.newText === null) return [];
  const kept = new Set(record.review?.kept ?? []);
  const dropped = new Set(record.review?.dropped ?? []);
  const reported = new Set(record.review?.reported ?? []);
  const edits = agentBlocks(reviewBody(record.originalText), reviewBody(record.newText)).flatMap((block) => block.edits);
  return edits.flatMap((edit) => {
    const isDropped = dropped.has(edit.key) || (record.wholeRejected && !kept.has(edit.key));
    if (!isDropped || reported.has(edit.key)) return [];
    const verb: Verb = record.mode === "applied" ? "undid" : "rejected";
    return [{ ref: { reviewId: record.id, key: edit.key }, filePath: record.filePath, verb, edit }];
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

function describeDrop(drop: DroppedEdit): string {
  const { removed, added, before } = drop.edit;
  return `- The writer ${drop.verb} your change to \`${drop.filePath}\`: you had ${phrase(removed, added, before)}.`;
}

/** The note for the agent's next prompt, or null when nothing was undone or rejected since it last heard. */
export function reviewFeedbackFor(thread: WorkspaceChatThread): ReviewFeedback | null {
  const items = thread.messages.flatMap(messageItems);
  if (items.length === 0) return null;
  const listed = items.slice(0, MAX_LISTED_CHANGES).map((item) => item.describe());
  const unlisted = items.length - listed.length;
  const lines = [
    "Since your last turn the writer took some of your edits back out:",
    ...listed,
    ...(unlisted > 0 ? [`- …and ${unlisted} more of your changes the writer undid or rejected.`] : []),
    "The writer chose this on purpose. Do not redo these changes unless the writer asks for them.",
  ];
  return { note: lines.join("\n"), sent: items.map((item) => item.ref) };
}

/** The user's message with the review note in front of it. */
export function withReviewFeedback(prompt: string, feedback: ReviewFeedback | null): string {
  return feedback ? `${feedback.note}\n\n${prompt}` : prompt;
}
