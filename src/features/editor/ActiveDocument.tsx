import { useCallback, useEffect, useMemo, useState } from "react";
import { CodeMirrorMarkdownEditor } from "./codemirror/CodeMirrorMarkdownEditor";
import { CommentsPanel } from "../comments/CommentsPanel";
import type { SourceRange } from "../comments/commentModel";
import { VersionHistory } from "../history/VersionHistory";
import type { DocumentExportFormat } from "./EditorFileActions";
import { exportMarkdownFile } from "../../lib/export/markdownExport";
import { exportDocumentToPdf } from "../../lib/export/pdfExport";
import { exportDocumentToHtml } from "../../lib/export/htmlExport";
import { showToast } from "../toast/toastStore";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { useUiStore } from "../../app/store/uiStore";
import { selectActiveWorkspace } from "../../app/store/activeWorkspace";
import { useWorkspaceLinkTargets } from "../../app/useWorkspaceLinkTargets";
import type { Workspace } from "../../app/workspaceModel";

/**
 * How long after the last edit the active file is auto-written to disk. Stacks
 * on the editor's own 500ms buffer debounce, so a disk write lands ~1.5s after
 * you stop typing — frequent enough that edits are safe, rare enough not to
 * thrash the filesystem.
 */
const AUTOSAVE_TO_DISK_MS = 1000;

/** Stable empty list so the comments selectors return a constant reference. */
const EMPTY_COMMENTS: Workspace["comments"] = [];

// ── DocumentEditor — the per-keystroke leaf ─────────────────────────────────

/**
 * The markdown editor itself, bound to the active file's BUFFER. This is the
 * ONLY component that subscribes to the file's content, so a keystroke
 * re-renders HERE and nowhere else — not the {@link ActiveDocument} shell, the
 * version-history modal, the conflict banner, or the comments panel (all of
 * which sit on stable, non-content state in the shell).
 *
 * Re-rendering per keystroke is intrinsic: the editor is a controlled component
 * (`value` is the live content), and CodeMirror's own loop-guard no-ops the
 * resulting sync when the change originated in the editor.
 */
function DocumentEditor({ onShowVersionHistory }: { onShowVersionHistory: () => void }) {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeFilePath = useWorkspaceStore(
    (state) => selectActiveWorkspace(state)?.activeFilePath ?? "",
  );
  const workspacePath = useWorkspaceStore((state) => selectActiveWorkspace(state)?.path);
  const content = useWorkspaceStore((state) => {
    const workspace = selectActiveWorkspace(state);
    return workspace?.activeFilePath
      ? workspace.fileContents[workspace.activeFilePath]?.content ?? ""
      : "";
  });
  const dirty = useWorkspaceStore((state) => {
    const workspace = selectActiveWorkspace(state);
    return Boolean(
      workspace?.activeFilePath && workspace.fileContents[workspace.activeFilePath]?.dirty,
    );
  });
  const comments = useWorkspaceStore(
    (state) => selectActiveWorkspace(state)?.comments ?? EMPTY_COMMENTS,
  );

  const addCommentToActiveFile = useWorkspaceStore((state) => state.addCommentToActiveFile);
  const saveActiveFile = useWorkspaceStore((state) => state.saveActiveFile);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const askAboutSelectionStream = useWorkspaceStore((state) => state.askAboutSelectionStream);
  const updateActiveContent = useWorkspaceStore((state) => state.updateActiveContent);

  const editorMode = useUiStore((state) => state.editorMode);
  const commentsOpen = useUiStore((state) => state.commentsOpen);
  const chatOpen = useUiStore((state) => state.chatOpen);
  const toggleComments = useUiStore((state) => state.toggleComments);
  const toggleChat = useUiStore((state) => state.toggleChat);

  const linkTargets = useWorkspaceLinkTargets();

  const activeFileComments = useMemo(() => {
    if (!activeFilePath) {
      return EMPTY_COMMENTS;
    }
    return comments.filter(
      (comment) => comment.filePath === activeFilePath && comment.status === "open",
    );
  }, [activeFilePath, comments]);

  // Debounced autosave-to-disk. When the active file is dirty, write it ~1s
  // after the last change. `saveActiveFile` flushes the editor's live content
  // first, so this persists exactly what's on screen. On success the buffer is
  // marked saved (dirty=false) and this guard stops scheduling — no write loop.
  useEffect(
    function autosaveActiveFileToDisk() {
      if (!dirty) {
        return;
      }
      const timer = window.setTimeout(() => {
        void saveActiveFile();
      }, AUTOSAVE_TO_DISK_MS);
      return () => window.clearTimeout(timer);
    },
    [content, dirty, saveActiveFile],
  );

  const navigateToFile = useCallback((path: string) => void selectFile(path), [selectFile]);
  // Stabilize the editor's Ask callback so React.memo on the editor can
  // short-circuit re-renders.
  const handleAskAboutSelection = useCallback(
    (question: string, selection: { range: SourceRange; text: string }) => {
      void askAboutSelectionStream(question, selection);
    },
    [askAboutSelectionStream],
  );
  // Stable identity so the memoised editor's `onQueueComment` prop doesn't
  // change every render — an inline arrow defeats the editor's React.memo.
  const handleQueueComment = useCallback(
    (note: string, selection: { range: SourceRange; text: string }) => {
      addCommentToActiveFile({
        body: note,
        range: selection.range,
        selectedText: selection.text,
      });
    },
    [addCommentToActiveFile],
  );
  // File-action callbacks read live state via the store rather than closing
  // over the per-keystroke buffer, so they stay referentially stable.
  const handleExport = useCallback(async (format: DocumentExportFormat) => {
    const workspace = useWorkspaceStore.getState().activeWorkspace();
    const relativePath = workspace?.activeFilePath;
    const buffer = relativePath ? workspace.fileContents[relativePath] : undefined;
    if (!workspace || !relativePath || !buffer) {
      return;
    }
    if (format === "markdown") {
      exportMarkdownFile({ filePath: relativePath, markdown: buffer.content });
      return;
    }
    const exporter = format === "html" ? exportDocumentToHtml : exportDocumentToPdf;
    const result = await exporter({ workspaceId: workspace.id, relativePath, content: buffer.content });
    if (result.status === "cancelled") {
      return;
    }
    showToast(
      result.status === "exported"
        ? { kind: "success", title: "Exported", message: `Saved to ${result.path}` }
        : { kind: "error", title: "Export failed", message: result.message },
    );
  }, []);

  return (
    <CodeMirrorMarkdownEditor
      comments={activeFileComments}
      mode={editorMode}
      value={content}
      workspaceId={activeWorkspaceId ?? undefined}
      workspaceRoot={workspacePath ?? undefined}
      filePath={activeFilePath || undefined}
      linkTargets={linkTargets}
      onNavigateToLink={navigateToFile}
      onChange={updateActiveContent}
      onAskAboutSelection={handleAskAboutSelection}
      onQueueComment={handleQueueComment}
      onSave={saveActiveFile}
      onShowVersionHistory={onShowVersionHistory}
      onExport={handleExport}
      onToggleComments={toggleComments}
      commentsOpen={commentsOpen}
      commentCount={activeFileComments.length}
      onToggleChat={toggleChat}
      chatOpen={chatOpen}
    />
  );
}

// ── ActiveDocument — the stable per-document shell ──────────────────────────

/**
 * The chrome around the active file's editor — the disk-conflict banner, the
 * comments side panel, and the version-history modal. Subscribes only to
 * STABLE per-document state (does the buffer exist, is it in conflict, which
 * comments, is the panel open) — never the content — so a keystroke re-renders
 * the {@link DocumentEditor} leaf inside it and leaves this shell, the modal,
 * and the panel untouched. Rendered by EditorRegion when the active file exists.
 */
export function ActiveDocument() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeFilePath = useWorkspaceStore(
    (state) => selectActiveWorkspace(state)?.activeFilePath ?? "",
  );
  const bufferLoaded = useWorkspaceStore((state) => {
    const workspace = selectActiveWorkspace(state);
    return Boolean(workspace?.activeFilePath && workspace.fileContents[workspace.activeFilePath]);
  });
  const inConflict = useWorkspaceStore((state) => {
    const workspace = selectActiveWorkspace(state);
    return Boolean(
      workspace?.activeFilePath && workspace.fileContents[workspace.activeFilePath]?.conflict,
    );
  });
  const allComments = useWorkspaceStore(
    (state) => selectActiveWorkspace(state)?.comments ?? EMPTY_COMMENTS,
  );
  const commentsOpen = useUiStore((state) => state.commentsOpen);

  const dismissConflict = useWorkspaceStore((state) => state.dismissConflict);
  const reloadActiveFile = useWorkspaceStore((state) => state.reloadActiveFile);
  const sendCommentsToChat = useWorkspaceStore((state) => state.sendCommentsToChat);
  const setCommentResolved = useWorkspaceStore((state) => state.setCommentResolved);

  // All comments for the active file (open + resolved) — the panel shows the
  // resolved ones in their own "done" section.
  const activeFileAllComments = useMemo(() => {
    if (!activeFilePath) {
      return EMPTY_COMMENTS;
    }
    return allComments.filter((comment) => comment.filePath === activeFilePath);
  }, [activeFilePath, allComments]);

  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  // Stable so the editor's React.memo isn't broken by a fresh callback identity.
  const handleShowVersionHistory = useCallback(() => setVersionHistoryOpen(true), []);
  const handleCloseVersionHistory = useCallback(() => setVersionHistoryOpen(false), []);
  const handleRestored = useCallback(() => void reloadActiveFile(), [reloadActiveFile]);

  // Buffer not loaded yet (file is in the scan list, its contents are still
  // being read). EditorRegion already confirmed the file exists.
  if (!bufferLoaded) {
    return (
      <div className="editor-body">
        <div className="empty-state">
          <div>
            <p className="empty-state__title">Loading file…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {inConflict ? (
        <div className="conflict-banner" role="alert">
          <span>{activeFilePath} was changed on disk since you opened it.</span>
          <div className="conflict-banner__actions">
            <button type="button" className="link-button" onClick={() => void reloadActiveFile()}>
              Reload from disk
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => activeFilePath && dismissConflict(activeFilePath)}
            >
              Keep my changes
            </button>
          </div>
        </div>
      ) : null}
      <div className="editor-body">
        <div
          className={[
            "document-workspace",
            commentsOpen ? "document-workspace--comments-open" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <DocumentEditor onShowVersionHistory={handleShowVersionHistory} />
          {commentsOpen ? (
            <CommentsPanel
              comments={activeFileAllComments}
              filePath={activeFilePath}
              onSendComments={(commentIds) => void sendCommentsToChat(commentIds)}
              onResolveComment={(commentId) => setCommentResolved(commentId, true)}
              onReopenComment={(commentId) => setCommentResolved(commentId, false)}
            />
          ) : null}
        </div>
      </div>
      <VersionHistory
        workspaceId={activeWorkspaceId ?? ""}
        filePath={activeFilePath}
        open={versionHistoryOpen}
        onClose={handleCloseVersionHistory}
        onRestored={handleRestored}
      />
    </>
  );
}
