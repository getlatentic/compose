import { useCallback, useEffect, useMemo, useState } from "react";

import { selectFocusedWorkspace } from "../../app/store/activeWorkspace";
import { useUiStore } from "../../app/store/uiStore";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { documentCapabilities } from "../../app/workspace/documents";
import { CommentsPanel } from "../comments/CommentsPanel";
import { useConfirm } from "../dialogs/ConfirmProvider";
import { VersionHistory } from "../history/VersionHistory";
import { DocumentEditor } from "./DocumentEditor";
import { EMPTY_COMMENTS } from "./useShownDocument";

/**
 * The note on disk changed under unsaved edits. "Reload from disk" throws
 * those edits away, so it asks first; "Keep my changes" loses nothing.
 */
function ConflictBanner({ filePath }: { readonly filePath: string }) {
  const dismissConflict = useWorkspaceStore((state) => state.dismissConflict);
  const reloadActiveFile = useWorkspaceStore((state) => state.reloadActiveFile);
  const confirm = useConfirm();
  const reload = useCallback(async () => {
    const confirmed = await confirm({
      title: "Discard your changes?",
      message: `${filePath} has unsaved changes. Reload the version on disk and discard them?`,
      confirmLabel: "Reload and discard",
      cancelLabel: "Keep editing",
      danger: true,
    });
    if (confirmed) void reloadActiveFile();
  }, [confirm, reloadActiveFile, filePath]);
  const reloadClick = useCallback(() => void reload(), [reload]);
  const keepClick = useCallback(() => dismissConflict(filePath), [dismissConflict, filePath]);
  return (
    <div className="conflict-banner" role="alert">
      <span>{filePath} was changed on disk since you opened it.</span>
      <div className="conflict-banner__actions">
        <button type="button" className="link-button" onClick={reloadClick}>
          Reload from disk
        </button>
        <button type="button" className="link-button" onClick={keepClick}>
          Keep my changes
        </button>
      </div>
    </div>
  );
}

/** The comments panel for the note: open and resolved comments, each sent to chat, resolved or reopened. */
function NoteCommentsPanel({ filePath }: { readonly filePath: string }) {
  const allComments = useWorkspaceStore((state) => selectFocusedWorkspace(state)?.comments ?? EMPTY_COMMENTS);
  const sendCommentsToChat = useWorkspaceStore((state) => state.sendCommentsToChat);
  const setCommentResolved = useWorkspaceStore((state) => state.setCommentResolved);
  const comments = useMemo(() => allComments.filter((comment) => comment.filePath === filePath), [allComments, filePath]);
  const send = useCallback((ids: string[]) => void sendCommentsToChat(ids), [sendCommentsToChat]);
  const resolve = useCallback((id: string) => setCommentResolved(id, true), [setCommentResolved]);
  const reopen = useCallback((id: string) => setCommentResolved(id, false), [setCommentResolved]);
  return <CommentsPanel comments={comments} filePath={filePath} onSendComments={send} onResolveComment={resolve} onReopenComment={reopen} />;
}

/**
 * Whether the note's buffer is loaded, and loading it when the active file
 * changes without a read: closing or deleting a tab, or restoring tabs on
 * open. The store guards against racing the read a tab click starts.
 */
function useActiveBuffer(filePath: string): { loaded: boolean; inConflict: boolean } {
  const loaded = useWorkspaceStore((state) => {
    const workspace = selectFocusedWorkspace(state);
    return Boolean(workspace?.activeFilePath && workspace.fileContents[workspace.activeFilePath]);
  });
  const inConflict = useWorkspaceStore((state) => {
    const workspace = selectFocusedWorkspace(state);
    return Boolean(workspace?.activeFilePath && workspace.fileContents[workspace.activeFilePath]?.conflict);
  });
  const ensureActiveBuffer = useWorkspaceStore((state) => state.ensureActiveBuffer);
  useEffect(() => {
    if (filePath && !loaded) void ensureActiveBuffer();
  }, [filePath, loaded, ensureActiveBuffer]);
  return { loaded, inConflict };
}

/**
 * Blank while the buffer loads, as VS Code does: a warm read swaps the editor
 * in before anything paints, and a hint fades in only past 800ms, so a slow
 * read (an iCloud download) is honest rather than a dead void.
 */
function LoadingNote() {
  return (
    <div className="editor-body">
      <div className="editor-body__loading" aria-busy="true">
        <p className="editor-body__loading-hint">Still opening…</p>
      </div>
    </div>
  );
}

/**
 * The chrome around the active file's editor: the disk-conflict banner, the
 * comments panel and the version history. It reads only state that does not
 * change as the writer types, so a keystroke re-renders the
 * {@link DocumentEditor} inside it and leaves the rest alone. EditorRegion
 * renders it once the active file exists.
 */
export function ActiveDocument() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const commentsEnabled = useWorkspaceStore((state) => documentCapabilities(selectFocusedWorkspace(state)).comments);
  const historyEnabled = useWorkspaceStore((state) => documentCapabilities(selectFocusedWorkspace(state)).versionHistory);
  const filePath = useWorkspaceStore((state) => selectFocusedWorkspace(state)?.activeFilePath ?? "");
  const reloadActiveFile = useWorkspaceStore((state) => state.reloadActiveFile);
  const commentsOpen = useUiStore((state) => state.commentsOpen);
  // Focus mode hides the comments panel too; `commentsOpen` is left as it
  // is, so leaving focus mode brings the panel back.
  const focusMode = useUiStore((state) => state.focusMode);
  const { loaded, inConflict } = useActiveBuffer(filePath);

  const [historyOpen, setHistoryOpen] = useState(false);
  const showHistory = useCallback(() => setHistoryOpen(true), []);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const restored = useCallback(() => void reloadActiveFile(), [reloadActiveFile]);

  if (!loaded) return <LoadingNote />;

  const showComments = commentsOpen && commentsEnabled && !focusMode;
  return (
    <>
      {inConflict ? <ConflictBanner filePath={filePath} /> : null}
      <div className="editor-body">
        <div className={showComments ? "document-workspace document-workspace--comments-open" : "document-workspace"}>
          <DocumentEditor onShowVersionHistory={historyEnabled ? showHistory : undefined} />
          {showComments ? <NoteCommentsPanel filePath={filePath} /> : null}
        </div>
      </div>
      <VersionHistory
        workspaceId={activeWorkspaceId ?? ""}
        filePath={filePath}
        open={historyOpen}
        onClose={closeHistory}
        onRestored={restored}
      />
    </>
  );
}
