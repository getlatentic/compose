import type { Workspace, WorkspaceDocumentSuggestion, WorkspaceRewriteSuggestion } from "../../app/workspaceModel";
import type { SandboxFile } from "../../lib/ipc/harnessClient";
import { reviewBody } from "./fileReviews";
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

/**
 * A rewrite as the sandbox should hold it: the note as it is now with every
 * still-undecided edit accepted. Accepted edits are already in the note and
 * rejected ones stay out. Untouched since the run, that is the proposal itself.
 */
function rewriteContent(suggestion: WorkspaceRewriteSuggestion, live: string | undefined): string | null {
  if (suggestion.originalText === null || suggestion.newText === null) return null;
  const decided = (suggestion.review?.kept.length ?? 0) + (suggestion.review?.dropped.length ?? 0) > 0;
  if (live === undefined || (!decided && live === suggestion.originalText)) return suggestion.newText;
  const body = reviewBody(live);
  if (!live.endsWith(body)) return suggestion.newText;
  const edits = liveEdits(
    {
      id: suggestion.id,
      mode: "pending",
      agentName: "",
      original: reviewBody(suggestion.originalText),
      proposed: reviewBody(suggestion.newText),
      kept: suggestion.review?.kept ?? [],
      dropped: suggestion.review?.dropped ?? [],
    },
    body,
  );
  return live.slice(0, live.length - body.length) + applyEdits(body, edits);
}

function sandboxFile(suggestion: WorkspaceDocumentSuggestion, workspace: Workspace): SandboxFile | null {
  const relativePath = suggestion.filePath;
  switch (suggestion.kind) {
    case "create":
      return suggestion.newText === null ? null : { relativePath, content: suggestion.newText };
    case "delete":
      return { relativePath, content: null };
    case "rewrite": {
      const content = rewriteContent(suggestion, workspace.fileContents[relativePath]?.content);
      return content === null ? null : { relativePath, content };
    }
    default:
      return null;
  }
}

/**
 * One waiting proposal per file, the newest: a new run's proposal carries
 * it forward. An older one for the same file is left as it is rather than
 * merged, so nothing is lost if the two overlap.
 */
export function waitingProposals(workspace: Workspace): WaitingProposals {
  const newestByFile = new Map<string, WorkspaceDocumentSuggestion>();
  for (const message of workspace.chatThread.messages) {
    for (const suggestion of message.suggestions ?? []) {
      if (suggestion.status === "pending" && suggestion.kind !== "replace") newestByFile.set(suggestion.filePath, suggestion);
    }
  }
  const files: SandboxFile[] = [];
  const suggestionIds: string[] = [];
  for (const suggestion of newestByFile.values()) {
    const file = sandboxFile(suggestion, workspace);
    if (!file) continue;
    files.push(file);
    suggestionIds.push(suggestion.id);
  }
  return files.length > 0 ? { files, suggestionIds } : NO_WAITING_PROPOSALS;
}
