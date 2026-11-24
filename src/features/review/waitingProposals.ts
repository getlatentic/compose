import type { Workspace, WorkspaceDocumentSuggestion, WorkspaceRewriteSuggestion } from "../../app/workspace/types";
import type { SandboxFile } from "../../lib/ipc/harnessRunClient";
import { fileReviewOf, reviewBody, rewriteRecord } from "./reviewRecord";
import { liveEdits, type LiveEdit } from "./liveEdits";

/**
 * The proposals of earlier runs still waiting for the writer, as the files a
 * new run's sandbox should start with, and the suggestions the new run's own
 * proposal will carry forward once it lands.
 */
export interface WaitingProposals {
  readonly files: readonly SandboxFile[];
  readonly suggestionIds: readonly string[];
}

export const NO_WAITING_PROPOSALS: WaitingProposals = { files: [], suggestionIds: [] };

/** Apply edits last-first, so earlier positions stay valid. */
function applyEdits(text: string, edits: readonly LiveEdit[]): string {
  return [...edits].sort((a, b) => b.from - a.from).reduce((note, edit) => note.slice(0, edit.from) + edit.replacement + note.slice(edit.to), text);
}

/** The note's text as it is now, from its open tab or as read from disk. */
export type NoteTexts = ReadonlyMap<string, string>;

function hasDecisions(suggestion: WorkspaceRewriteSuggestion): boolean {
  return (suggestion.review?.kept.length ?? 0) + (suggestion.review?.dropped.length ?? 0) > 0;
}

/**
 * A rewrite as the sandbox should hold it: the note as it is now with every
 * still-undecided edit accepted. Accepted edits are already in the note and
 * rejected ones stay out. Untouched since the run, that is the proposal
 * itself. Once the writer has decided an edit, only the note's current text
 * can say what stays out; without it the proposal is not carried (`null`),
 * so a rejected edit is never offered again.
 */
function rewriteContent(suggestion: WorkspaceRewriteSuggestion, live: string | undefined): string | null {
  if (suggestion.originalText === null || suggestion.newText === null) return null;
  const decided = hasDecisions(suggestion);
  if (!decided && (live === undefined || live === suggestion.originalText)) return suggestion.newText;
  if (live === undefined) return null;
  const body = reviewBody(live);
  if (!live.endsWith(body)) return decided ? null : suggestion.newText;
  const review = fileReviewOf(rewriteRecord(suggestion), "");
  if (!review) return null;
  const edits = liveEdits(review, body);
  return live.slice(0, live.length - body.length) + applyEdits(body, edits);
}

function sandboxFile(suggestion: WorkspaceDocumentSuggestion, workspace: Workspace, notes: NoteTexts): SandboxFile | null {
  const relativePath = suggestion.filePath;
  switch (suggestion.kind) {
    case "create":
      return suggestion.newText === null ? null : { relativePath, content: suggestion.newText };
    case "delete":
      return { relativePath, content: null };
    case "rewrite": {
      const content = rewriteContent(suggestion, workspace.fileContents[relativePath]?.content ?? notes.get(relativePath));
      return content === null ? null : { relativePath, content };
    }
    default:
      return null;
  }
}

function newestWaiting(workspace: Workspace): WorkspaceDocumentSuggestion[] {
  const newestByFile = new Map<string, WorkspaceDocumentSuggestion>();
  for (const message of workspace.chatThread.messages) {
    for (const suggestion of message.suggestions ?? []) {
      if (suggestion.status === "pending" && suggestion.kind !== "replace") newestByFile.set(suggestion.filePath, suggestion);
    }
  }
  return [...newestByFile.values()];
}

/**
 * The notes whose text {@link waitingProposals} needs and no open tab holds:
 * a decided rewrite of a note whose tab was closed. The caller reads them
 * from disk and passes them in.
 */
export function notesToRead(workspace: Workspace): string[] {
  return newestWaiting(workspace)
    .filter((suggestion) => suggestion.kind === "rewrite" && hasDecisions(suggestion))
    .map((suggestion) => suggestion.filePath)
    .filter((path) => workspace.fileContents[path] === undefined);
}

/**
 * One waiting proposal per file, the newest: a new run's proposal carries
 * it forward. An older one for the same file is left as it is rather than
 * merged, so nothing is lost if the two overlap.
 */
export function waitingProposals(workspace: Workspace, notes: NoteTexts = new Map()): WaitingProposals {
  const files: SandboxFile[] = [];
  const suggestionIds: string[] = [];
  for (const suggestion of newestWaiting(workspace)) {
    const file = sandboxFile(suggestion, workspace, notes);
    if (!file) continue;
    files.push(file);
    suggestionIds.push(suggestion.id);
  }
  return files.length > 0 ? { files, suggestionIds } : NO_WAITING_PROPOSALS;
}
