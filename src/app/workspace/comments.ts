import { applyDocumentChangesToComments, createCommentThread, moveCommentsToFile, type DocumentTextChange, type SourceRange } from "../../features/comments/commentModel";
import { markBufferDirty } from "./files";
import type { Workspace } from "./types";

/**
 * Comments on a workspace's notes.
 */

export function commentsForFile(workspace: Workspace, filePath: string) {
  return workspace.comments.filter(
    (comment) => comment.filePath === filePath && comment.status === "open",
  );
}

export function addWorkspaceComment(
  workspace: Workspace,
  input: {
    body: string;
    filePath: string;
    range: SourceRange;
    selectedText: string;
    timestamp: number;
  },
): Workspace {
  const buffer = workspace.fileContents[input.filePath];
  if (!buffer || !input.body.trim() || input.range.start >= input.range.end) {
    return workspace;
  }

  // One comment per highlight: if an open comment on this file overlaps the
  // selection, edit its note in place instead of stacking a duplicate. The
  // anchor stays put — you're editing the existing comment, not re-pinning it.
  const overlapping = workspace.comments.find(
    (existing) =>
      existing.filePath === input.filePath
      && existing.status === "open"
      && input.range.start < existing.anchor.range.end
      && existing.anchor.range.start < input.range.end,
  );
  if (overlapping) {
    return {
      ...workspace,
      comments: workspace.comments.map((existing) =>
        existing.id === overlapping.id
          ? { ...existing, body: input.body.trim(), updatedAt: input.timestamp }
          : existing,
      ),
    };
  }

  const comment = createCommentThread({
    body: input.body,
    filePath: input.filePath,
    fullText: buffer.content,
    id: `comment-${input.timestamp}-${workspace.comments.length + 1}`,
    range: input.range,
    selectedText: input.selectedText,
    timestamp: input.timestamp,
  });

  return {
    ...workspace,
    comments: [...workspace.comments, comment],
  };
}

export function applyWorkspaceDocumentChanges(
  workspace: Workspace,
  relativePath: string,
  content: string,
  changes: DocumentTextChange[],
  timestamp: number,
): Workspace {
  const next = markBufferDirty(workspace, relativePath, content, changes);
  if (next === workspace || changes.length === 0) {
    return next;
  }

  return {
    ...next,
    comments: applyDocumentChangesToComments(next.comments, relativePath, changes, timestamp),
  };
}

export function moveWorkspaceComments(
  workspace: Workspace,
  fromFilePath: string,
  toFilePath: string,
  timestamp: number,
): Workspace {
  return {
    ...workspace,
    comments: moveCommentsToFile(workspace.comments, fromFilePath, toFilePath, timestamp),
  };
}

/** Flip a comment open ↔ resolved (the "done" state shown in the panel). */
export function setWorkspaceCommentStatus(
  workspace: Workspace,
  commentId: string,
  status: "open" | "resolved",
  timestamp: number,
): Workspace {
  return {
    ...workspace,
    comments: workspace.comments.map((comment) =>
      comment.id === commentId ? { ...comment, status, updatedAt: timestamp } : comment,
    ),
  };
}
