import { PositionMapper, type SourceRange } from "../../features/comments/commentModel";
import { ensureAssistantMessage } from "./chatRun";
import { applyWorkspaceDocumentChanges } from "./comments";
import type { SuggestedEditInput, Workspace, WorkspaceAppliedChange, WorkspaceChatThread, WorkspaceDocumentSuggestion, WorkspaceReviewSuggestionDraft, WorkspaceSuggestionDraft, WorkspaceSuggestionPreparation, WorkspaceSuggestionStatus } from "./types";

/**
 * An agent's proposed and applied changes, and the writer's decisions on them.
 */

export function prepareWorkspaceSuggestionDrafts(
  workspace: Workspace,
  edits: SuggestedEditInput[],
): WorkspaceSuggestionPreparation {
  const drafts: WorkspaceSuggestionDraft[] = [];
  let rejectedCount = 0;
  // One mapper per file content reused across edits targeting the same
  // buffer — a batch of suggestions from one harness turn typically hits the
  // same document many times.
  const mappersByFilePath = new Map<string, PositionMapper>();

  for (const edit of edits) {
    const filePath = edit.filePath.trim();
    const buffer = workspace.fileContents[filePath];
    if (!buffer) {
      rejectedCount += 1;
      continue;
    }
    let mapper = mappersByFilePath.get(filePath);
    if (!mapper || mapper.text !== buffer.content) {
      mapper = new PositionMapper(buffer.content);
      mappersByFilePath.set(filePath, mapper);
    }
    const rangeIsValid =
      Number.isInteger(edit.range.start) &&
      Number.isInteger(edit.range.end) &&
      edit.range.start >= 0 &&
      edit.range.end >= edit.range.start &&
      edit.range.end <= mapper.byteLength;

    if (!rangeIsValid) {
      rejectedCount += 1;
      continue;
    }

    const originalText = mapper.sliceByByteRange(edit.range);
    if (originalText === edit.replacement) {
      rejectedCount += 1;
      continue;
    }

    drafts.push({
      filePath,
      originalText,
      range: { ...edit.range },
      replacement: edit.replacement,
      title: edit.title?.trim() || "Suggested edit",
    });
  }

  return { drafts, rejectedCount };
}

export function appendAssistantSuggestions(
  chatThread: WorkspaceChatThread,
  runId: string,
  drafts: WorkspaceSuggestionDraft[],
  timestamp: number,
): WorkspaceChatThread {
  if (drafts.length === 0 || chatThread.activeRunId !== runId) {
    return chatThread;
  }

  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((message) => {
      if (message.id !== messageId) {
        return message;
      }
      const existingSuggestions = message.suggestions ?? [];
      const nextSuggestions = drafts.map((draft, index) => ({
        kind: "replace" as const,
        createdAt: timestamp,
        filePath: draft.filePath,
        id: `${messageId}-suggestion-${existingSuggestions.length + index + 1}`,
        originalText: draft.originalText,
        range: { ...draft.range },
        replacement: draft.replacement,
        runId,
        status: "pending" as const,
        statusMessage: null,
        title: draft.title,
        updatedAt: timestamp,
      }));
      return {
        ...message,
        activity: `${nextSuggestions.length} suggested edit${nextSuggestions.length === 1 ? "" : "s"}`,
        suggestions: [...existingSuggestions, ...nextSuggestions],
      };
    }),
  };
}

/**
 * Attach file-level review changes (create / rewrite / delete, from the clone
 * gate) to a run's assistant message as pending suggestions. Unlike
 * `appendAssistantSuggestions` this runs *after* the run finished, so it finds
 * the message by `runId` rather than the active run.
 */
export function appendReviewChangeSuggestions(
  chatThread: WorkspaceChatThread,
  runId: string,
  drafts: WorkspaceReviewSuggestionDraft[],
  timestamp: number,
): WorkspaceChatThread {
  if (drafts.length === 0) {
    return chatThread;
  }
  const target = [...chatThread.messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.runId === runId);
  if (!target) {
    return chatThread;
  }
  const messageId = target.id;
  return {
    ...chatThread,
    messages: chatThread.messages.map((message) => {
      if (message.id !== messageId) {
        return message;
      }
      const existing = message.suggestions ?? [];
      const next = drafts.map((draft, index): WorkspaceDocumentSuggestion => {
        const base = {
          id: `${messageId}-suggestion-${existing.length + index + 1}`,
          runId,
          filePath: draft.filePath,
          title: reviewChangeTitle(draft.kind),
          status: "pending" as const,
          statusMessage: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        if (draft.kind === "create") {
          return {
            ...base,
            kind: "create",
            newText: draft.newText,
            newSize: draft.newSize,
            previewOmitted: draft.previewOmitted,
          };
        }
        if (draft.kind === "delete") {
          return {
            ...base,
            kind: "delete",
            originalText: draft.originalText,
            originalSize: draft.originalSize,
            previewOmitted: draft.previewOmitted,
            stale: draft.stale,
          };
        }
        return {
          ...base,
          kind: "rewrite",
          originalText: draft.originalText,
          newText: draft.newText,
          originalSize: draft.originalSize,
          newSize: draft.newSize,
          previewOmitted: draft.previewOmitted,
          stale: draft.stale,
        };
      });
      const total = existing.length + next.length;
      return {
        ...message,
        activity: `${total} change${total === 1 ? "" : "s"} to review`,
        suggestions: [...existing, ...next],
      };
    }),
  };
}

/**
 * Attach the file changes a `snapshot`-mode run already made to its assistant
 * message as informational `appliedChanges` (a diff to read, not approve). The
 * draft's `stale` flag is irrelevant here and dropped. Mirrors
 * `appendReviewChangeSuggestions`, minus the pending/accept machinery.
 */
export function appendAppliedChanges(
  chatThread: WorkspaceChatThread,
  runId: string,
  drafts: WorkspaceReviewSuggestionDraft[],
): WorkspaceChatThread {
  if (drafts.length === 0) {
    return chatThread;
  }
  const target = [...chatThread.messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.runId === runId);
  if (!target) {
    return chatThread;
  }
  const messageId = target.id;
  return {
    ...chatThread,
    messages: chatThread.messages.map((message) => {
      if (message.id !== messageId) {
        return message;
      }
      const existing = message.appliedChanges ?? [];
      const next: WorkspaceAppliedChange[] = drafts.map((draft, index) => ({
        id: `${messageId}-applied-${existing.length + index + 1}`,
        kind: draft.kind,
        filePath: draft.filePath,
        originalText: draft.originalText,
        newText: draft.newText,
        originalSize: draft.originalSize,
        newSize: draft.newSize,
        previewOmitted: draft.previewOmitted,
      }));
      const total = existing.length + next.length;
      return {
        ...message,
        activity: `${total} file${total === 1 ? "" : "s"} changed`,
        appliedChanges: [...existing, ...next],
      };
    }),
  };
}

function reviewChangeTitle(kind: WorkspaceReviewSuggestionDraft["kind"]): string {
  switch (kind) {
    case "create":
      return "New file";
    case "delete":
      return "Delete file";
    default:
      return "Updated file";
  }
}

export function acceptWorkspaceSuggestion(
  workspace: Workspace,
  suggestionId: string,
  timestamp: number,
): Workspace {
  const suggestion = findSuggestion(workspace.chatThread, suggestionId);
  if (!suggestion || suggestion.status !== "pending") {
    return workspace;
  }
  // Only bob's byte-range edits apply to the in-memory buffer here. File-level
  // changes (create / rewrite / delete from the clone gate) are applied to
  // disk through the review session by the store, which then marks status via
  // `markWorkspaceSuggestion`.
  if (suggestion.kind !== "replace") {
    return workspace;
  }

  const buffer = workspace.fileContents[suggestion.filePath];
  if (!buffer) {
    return updateWorkspaceSuggestion(workspace, suggestionId, {
      status: "stale",
      statusMessage: "File is not loaded.",
      updatedAt: timestamp,
    });
  }

  const mapper = new PositionMapper(buffer.content);
  const currentText = mapper.sliceByByteRange(suggestion.range);
  if (currentText !== suggestion.originalText) {
    return updateWorkspaceSuggestion(workspace, suggestionId, {
      status: "stale",
      statusMessage: "Source changed since this edit was suggested.",
      updatedAt: timestamp,
    });
  }

  const content = replaceByByteRange(mapper, suggestion.range, suggestion.replacement);
  const changed = applyWorkspaceDocumentChanges(
    workspace,
    suggestion.filePath,
    content,
    [{ range: suggestion.range, text: suggestion.replacement }],
    timestamp,
  );

  return updateWorkspaceSuggestion(changed, suggestionId, {
    status: "accepted",
    statusMessage: null,
    updatedAt: timestamp,
  });
}

export function rejectWorkspaceSuggestion(
  workspace: Workspace,
  suggestionId: string,
  timestamp: number,
): Workspace {
  const suggestion = findSuggestion(workspace.chatThread, suggestionId);
  if (!suggestion || suggestion.status !== "pending") {
    return workspace;
  }

  return updateWorkspaceSuggestion(workspace, suggestionId, {
    status: "rejected",
    statusMessage: null,
    updatedAt: timestamp,
  });
}

// NOTE: bob's stream-json parsing used to live here
// (`parseBobStreamLine` + helpers). It moved to Rust as
// `compose_core::events::parse_bob_line` / `normalize_bob_event`,
// which emit the normalized `RunEvent` stream every harness shares.
// The front-end now consumes already-decoded events (see
// `handleHarnessRunEvent` in `workspaceStore.ts`) and no longer parses a
// harness wire format. `SuggestedEditInput` stays — it's the
// shape `prepareWorkspaceSuggestionDrafts` consumes.

function findSuggestion(
  chatThread: WorkspaceChatThread,
  suggestionId: string,
): WorkspaceDocumentSuggestion | null {
  for (const message of chatThread.messages) {
    const suggestion = message.suggestions?.find((item) => item.id === suggestionId);
    if (suggestion) {
      return suggestion;
    }
  }
  return null;
}

/**
 * Set a suggestion's status from outside the model — used by the store after
 * a file-level review change is applied (or fails) on disk, where the pure
 * model can't do the I/O itself.
 */
export function markWorkspaceSuggestion(
  workspace: Workspace,
  suggestionId: string,
  status: WorkspaceSuggestionStatus,
  statusMessage: string | null,
  timestamp: number,
): Workspace {
  return updateWorkspaceSuggestion(workspace, suggestionId, {
    status,
    statusMessage,
    updatedAt: timestamp,
  });
}

function updateWorkspaceSuggestion(
  workspace: Workspace,
  suggestionId: string,
  updates: Pick<WorkspaceDocumentSuggestion, "status" | "statusMessage" | "updatedAt">,
): Workspace {
  return {
    ...workspace,
    chatThread: {
      ...workspace.chatThread,
      messages: workspace.chatThread.messages.map((message) => {
        if (!message.suggestions?.some((suggestion) => suggestion.id === suggestionId)) {
          return message;
        }
        return {
          ...message,
          suggestions: message.suggestions.map((suggestion) =>
            suggestion.id === suggestionId ? { ...suggestion, ...updates } : suggestion,
          ),
        };
      }),
    },
  };
}

function replaceByByteRange(mapper: PositionMapper, range: SourceRange, replacement: string) {
  const start = mapper.byteToCodeUnit(range.start);
  const end = mapper.byteToCodeUnit(range.end);
  return `${mapper.text.slice(0, start)}${replacement}${mapper.text.slice(end)}`;
}
