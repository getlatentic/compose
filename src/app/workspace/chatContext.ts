import type { WorkspaceCommentThread } from "../../features/comments/commentModel";
import type { LlmContextSnapshotInput, WorkspaceChatThread, WorkspaceContextItem, WorkspaceFileContextItem, WorkspaceFileEntry } from "./types";

/**
 * What the chat is told about: files and comments added as context.
 */

export function setCurrentTabContext(
  chatThread: WorkspaceChatThread,
  workspaceId: string,
  filePath: string,
): WorkspaceChatThread {
  if (!filePath) {
    return {
      ...chatThread,
      contextItems: [],
    };
  }

  return {
    ...chatThread,
    contextItems: [
      {
        id: createContextId(workspaceId, filePath),
        kind: "file",
        label: filePath,
        path: filePath,
        workspaceId,
      },
    ],
  };
}

/**
 * File context items whose path is no longer in the tree — an external
 * deletion or a sync eviction. Mark-not-remove: the chips stay (the user
 * pinned them; the file may return), but render a "missing" state and the
 * send surfaces a notice. Callers gate on `scanState === "ready"` so a
 * mid-boot scan can't flash every chip missing. Derived from the file list,
 * so it self-heals the moment the file reappears.
 */
export function missingFileContextPaths(
  contextItems: WorkspaceContextItem[],
  files: WorkspaceFileEntry[],
  looseFiles: WorkspaceFileEntry[] = [],
): string[] {
  const present = new Set(files.map((entry) => entry.relativePath));
  const loosePresent = new Set(looseFiles.map((entry) => entry.relativePath));
  return contextItems
    .filter((item): item is WorkspaceFileContextItem => item.kind === "file")
    .filter((item) => {
      // External chips are judged against the external-files list.
      if (item.origin === "external") {
        return !loosePresent.has(item.path);
      }
      // Other absolute paths are spilled attachments in app scratch — outside
      // any tree by design, never "missing".
      if (item.path.startsWith("/")) {
        return false;
      }
      return !present.has(item.path);
    })
    .map((item) => item.path);
}

/** Remove a file from the chat context by path (e.g. when it's deleted), leaving
 *  any other attached context untouched. */
export function removeFileContext(
  chatThread: WorkspaceChatThread,
  filePath: string,
): WorkspaceChatThread {
  return {
    ...chatThread,
    contextItems: chatThread.contextItems.filter(
      (item) => !(item.kind === "file" && item.path === filePath),
    ),
  };
}

/** Re-point a file already in the chat context to its new path on rename, so a
 *  pinned context survives the rename instead of dangling or being replaced. */
export function renameContextItemPath(
  chatThread: WorkspaceChatThread,
  workspaceId: string,
  from: string,
  to: string,
): WorkspaceChatThread {
  return {
    ...chatThread,
    contextItems: chatThread.contextItems.map((item) => {
      if (item.kind === "file" && item.path === from) {
        return { ...item, id: createContextId(workspaceId, to), label: to, path: to };
      }
      // A comment excerpt in chat references its file by path too (the prompt
      // emits `File: <filePath>`); re-point it so the agent never reads the old,
      // now-missing path.
      if (item.kind === "comment" && item.filePath === from) {
        return { ...item, filePath: to, path: item.path === from ? to : item.path };
      }
      return item;
    }),
  };
}

function fileContextItem(workspaceId: string, filePath: string): WorkspaceFileContextItem {
  return {
    id: createContextId(workspaceId, filePath),
    kind: "file",
    label: filePath,
    path: filePath,
    workspaceId,
  };
}

/**
 * Add a file as chat context (deduped by id), with an explicit display label —
 * for an attachment whose label isn't its path (e.g. "Pasted text (12 KB)").
 * Re-adding the same path replaces the existing chip so the label stays current.
 */
export function addFileContextItem(
  chatThread: WorkspaceChatThread,
  workspaceId: string,
  filePath: string,
  label: string,
  origin?: "external",
): WorkspaceChatThread {
  const item: WorkspaceFileContextItem = {
    ...fileContextItem(workspaceId, filePath),
    label,
    ...(origin ? { origin } : {}),
  };
  const withoutDup = chatThread.contextItems.filter((existing) => existing.id !== item.id);
  return { ...chatThread, contextItems: [...withoutDup, item] };
}

/** Remove a chat context item by id (a chip's ✕). */
export function removeContextItem(
  chatThread: WorkspaceChatThread,
  id: string,
): WorkspaceChatThread {
  return {
    ...chatThread,
    contextItems: chatThread.contextItems.filter((item) => item.id !== id),
  };
}

function commentContextItem(
  workspaceId: string,
  comment: WorkspaceCommentThread,
): WorkspaceContextItem {
  return {
    anchor: comment.anchor,
    commentBody: comment.body,
    filePath: comment.filePath,
    id: `${workspaceId}:${comment.id}`,
    kind: "comment",
    label: `Comment on ${comment.filePath}`,
    path: comment.filePath,
    range: comment.anchor.range,
    selectedText: comment.anchor.selectedText,
    surroundingContext: `${comment.anchor.prefix}${comment.anchor.selectedText}${comment.anchor.suffix}`,
    workspaceId,
  };
}

/**
 * Attach one or more comments (with their files, deduped) as the chat's
 * context — the basis for "Send N comments to chat". `createPromptWithContext`
 * already renders multiple comment blocks, so N just works downstream.
 */
export function setCommentsChatContext(
  chatThread: WorkspaceChatThread,
  workspaceId: string,
  comments: WorkspaceCommentThread[],
): WorkspaceChatThread {
  const seenFiles = new Set<string>();
  const fileItems: WorkspaceContextItem[] = [];
  const commentItems: WorkspaceContextItem[] = [];
  for (const comment of comments) {
    if (!seenFiles.has(comment.filePath)) {
      seenFiles.add(comment.filePath);
      fileItems.push(fileContextItem(workspaceId, comment.filePath));
    }
    commentItems.push(commentContextItem(workspaceId, comment));
  }
  return { ...chatThread, contextItems: [...fileItems, ...commentItems] };
}

export function setCommentChatContext(
  chatThread: WorkspaceChatThread,
  workspaceId: string,
  comment: WorkspaceCommentThread,
): WorkspaceChatThread {
  return setCommentsChatContext(chatThread, workspaceId, [comment]);
}

export function createLlmContextSnapshots(
  contextItems: WorkspaceContextItem[],
): LlmContextSnapshotInput[] {
  return contextItems.map((item) => {
    if (item.kind === "file") {
      return {
        filePath: item.path,
        kind: "file",
      };
    }

    return {
      anchor: item.anchor,
      filePath: item.filePath,
      kind: "comment",
      selectedTextSnapshot: item.selectedText,
      sourceCommentId: item.id.split(":").slice(1).join(":") || item.id,
      sourceRange: item.range,
      surroundingContextSnapshot: item.surroundingContext,
    };
  });
}

/**
 * The display labels of the files currently attached as context — persisted
 * alongside a conversation so the history list can show its attached-file
 * chips. De-duplicated, file context items only (comment context is anchored
 * to a file already counted). Labels (not paths) since they're user-facing.
 */
export function chatThreadContextFileLabels(thread: WorkspaceChatThread): string[] {
  const labels = thread.contextItems
    .filter((item) => item.kind === "file")
    .map((item) => item.label);
  return Array.from(new Set(labels));
}

function createContextId(workspaceId: string, filePath: string) {
  return `${workspaceId}:${filePath}`;
}
