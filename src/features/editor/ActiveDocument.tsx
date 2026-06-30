import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { EditorView } from "@codemirror/view";
import {
  CodeMirrorMarkdownEditor,
  type EditorSelectionSnapshot,
} from "ai-editor";
import { CodeMirrorToolbar } from "./CodeMirrorToolbar";
import { CommentBubble, CommentComposer } from "./CommentBubble";
import { pickImageFileForCaret } from "ai-editor";
import { CommentsPanel } from "../comments/CommentsPanel";
import type { SourceRange } from "../comments/commentModel";
import { VersionHistory } from "../history/VersionHistory";
import { EditorFileActions, type DocumentExportFormat } from "./EditorFileActions";
import { exportMarkdownFile } from "../../lib/export/markdownExport";
import { exportDocumentToPdf } from "../../lib/export/pdfExport";
import { exportDocumentToHtml } from "../../lib/export/htmlExport";
import { printDocument } from "../../lib/export/printDocument";
import { resolveDisplaySrc } from "./imageDisplaySrc";
import { writeBinaryFile } from "../../lib/ipc/filesClient";
import { openExternalUrl } from "../../lib/links/openExternal";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { markBoot, markTabSwitchEnd } from "../../lib/perf";
import { registerActiveEditorFlush } from "../../lib/editor/editorFlush";
import { showToast } from "../toast/toastStore";
import { useConfirm } from "../dialogs/ConfirmProvider";
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
  // An open "comment on this table row/column" composer: the excerpt to comment
  // on + the viewport point to anchor it near. Null when none is open.
  const [tableComment, setTableComment] = useState<{
    excerpt: { range: SourceRange; text: string };
    anchor: { x: number; y: number };
  } | null>(null);

  const activeFileComments = useMemo(() => {
    if (!activeFilePath) {
      return EMPTY_COMMENTS;
    }
    return comments.filter(
      (comment) => comment.filePath === activeFilePath && comment.status === "open",
    );
  }, [activeFilePath, comments]);

  // Boot profile: the active note's editor leaf is mounting — the note is on
  // screen now (the last boot phase). No-op outside COMPOSE_PERF builds.
  useEffect(() => {
    markBoot("doc");
  }, []);

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
  // Persist a pasted/dropped image to the workspace's `images/` dir via the
  // Tauri file API. Closes over the active workspace id so the editor stays
  // workspace-agnostic (it only knows "save these bytes at this relative path").
  const saveImageBytes = useCallback(
    async (relPath: string, bytes: Uint8Array) => {
      await writeBinaryFile(activeWorkspaceId ?? "preview", relPath, bytes);
    },
    [activeWorkspaceId],
  );
  // Stabilize the editor's Ask callback so React.memo on the editor can
  // short-circuit re-renders.
  const handleAskAboutSelection = useCallback(
    (question: string, selection: { range: SourceRange; text: string }) => {
      void askAboutSelectionStream(question, selection);
    },
    [askAboutSelectionStream],
  );
  // "Comment on this table row/column" from the right-click menu: open the same
  // comment composer a text selection uses, anchored near the click, seeded with
  // the row/column excerpt. Queue / Send to chat then run the existing comment
  // and selection→chat paths (below), so a table comment is just a comment.
  const handleCommentOnExcerpt = useCallback(
    (excerpt: { range: SourceRange; text: string }, anchor: { x: number; y: number }) => {
      setTableComment({ excerpt, anchor });
    },
    [],
  );
  // Close the composer and drop the persistent tint the menu left on the
  // commented row/column (a theme class the editor set; cleared by class here).
  const closeTableComment = useCallback(() => {
    document
      .querySelectorAll(".cm-table-cell--commenting")
      .forEach((cell) => cell.classList.remove("cm-table-cell--commenting"));
    setTableComment(null);
  }, []);
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

  // Print the active document through the system print panel. Reads live state
  // from the store (not the per-keystroke buffer prop), so it stays referentially
  // stable like handleExport.
  const handlePrint = useCallback(async () => {
    const workspace = useWorkspaceStore.getState().activeWorkspace();
    const relativePath = workspace?.activeFilePath;
    const buffer = relativePath ? workspace.fileContents[relativePath] : undefined;
    if (!workspace || !relativePath || !buffer) {
      return;
    }
    try {
      await printDocument({ workspaceId: workspace.id, relativePath, content: buffer.content });
    } catch (error) {
      showToast({ kind: "error", title: "Print failed", message: String(error) });
    }
  }, []);

  // File → Print / ⌘P (a native menu item) emits `menu://print`; open the system
  // print panel (a printer, or Save as PDF from the panel) for the active note.
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    const unlisten = listen("menu://print", () => void handlePrint());
    return () => {
      void unlisten.then((off) => off());
    };
  }, [handlePrint]);

  // The host owns its toolbar actions and hands them to the editor as one
  // stable slot — the editor itself stays agnostic about save / export /
  // comments / chat. Memoised (its deps don't change on a keystroke) so the
  // editor's toolbar memo holds.
  const fileActions = useMemo(
    () => (
      <EditorFileActions
        onSave={saveActiveFile}
        onShowVersionHistory={onShowVersionHistory}
        onExport={handleExport}
        onToggleComments={toggleComments}
        commentsOpen={commentsOpen}
        commentCount={activeFileComments.length}
        onToggleChat={toggleChat}
        chatOpen={chatOpen}
      />
    ),
    [
      saveActiveFile,
      onShowVersionHistory,
      handleExport,
      toggleComments,
      commentsOpen,
      activeFileComments.length,
      toggleChat,
      chatOpen,
    ],
  );

  // Compose's toolbar (Carbon icons + its dialog providers) handed to the
  // editor as a slot. Stable across keystrokes — its deps don't change while
  // typing — so the editor's toolbar memo holds. `onInsertImage` runs the
  // editor's own image-pick pipeline against the live view.
  const toolbar = useCallback(
    ({ view }: { view: EditorView }) => (
      <CodeMirrorToolbar
        view={view}
        mode={editorMode}
        fileActions={fileActions}
        linkTargets={linkTargets}
        onInsertImage={() => pickImageFileForCaret(view)}
      />
    ),
    [editorMode, fileActions, linkTargets],
  );

  // The selection comment bubble, handed to the editor as a slot. The editor
  // supplies the live selection + a `dismiss` that collapses it.
  const selectionActions = useCallback(
    ({
      selection,
      dismiss,
    }: {
      selection: EditorSelectionSnapshot | null;
      dismiss: () => void;
    }) => (
      <CommentBubble
        hasEditor
        selection={selection}
        dismissSelection={dismiss}
        onSendToChat={handleAskAboutSelection}
        onQueueComment={handleQueueComment}
      />
    ),
    [handleAskAboutSelection, handleQueueComment],
  );

  return (
    <>
      <CodeMirrorMarkdownEditor
        mode={editorMode}
        value={content}
        workspaceRoot={workspacePath ?? undefined}
        filePath={activeFilePath || undefined}
        linkTargets={linkTargets}
        onNavigateToLink={navigateToFile}
        onChange={updateActiveContent}
        toolbar={toolbar}
        selectionActions={selectionActions}
        resolveImageSrc={resolveDisplaySrc}
        saveImageBytes={saveImageBytes}
        onOpenExternalUrl={openExternalUrl}
        onCommentOnExcerpt={handleCommentOnExcerpt}
        onAfterContentSwap={markTabSwitchEnd}
        onFlushReady={registerActiveEditorFlush}
      />
      {tableComment ? (
        <CommentComposer
          selectionText={tableComment.excerpt.text}
          style={tableComposerStyle(tableComment.anchor)}
          onSend={(note) => {
            handleAskAboutSelection(note, tableComment.excerpt);
            closeTableComment();
          }}
          onQueue={(note) => {
            handleQueueComment(note, tableComment.excerpt);
            closeTableComment();
          }}
          onClose={closeTableComment}
        />
      ) : null}
    </>
  );
}

/** Place the table-comment composer just below the click, clamped to the
 *  viewport. Matches the width the selection composer uses. */
function tableComposerStyle(anchor: { x: number; y: number }): CSSProperties {
  const WIDTH = 360;
  const left = Math.min(Math.max(16, anchor.x - WIDTH / 2), window.innerWidth - WIDTH - 16);
  const top = Math.min(anchor.y + 8, window.innerHeight - 240);
  return { top, left, width: WIDTH };
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
  const confirm = useConfirm();
  const sendCommentsToChat = useWorkspaceStore((state) => state.sendCommentsToChat);
  const setCommentResolved = useWorkspaceStore((state) => state.setCommentResolved);
  const ensureActiveBuffer = useWorkspaceStore((state) => state.ensureActiveBuffer);

  // Active file ⇒ its buffer loads. `selectFile` reads on a tab click, but
  // closing or deleting a tab (and tab restore on open) repoints the active file
  // without a read — load it here so the editor never strands on "Loading file…"
  // (#50). The store guards against a double read racing `selectFile`.
  useEffect(() => {
    if (activeFilePath && !bufferLoaded) {
      void ensureActiveBuffer();
    }
  }, [activeFilePath, bufferLoaded, ensureActiveBuffer]);

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

  // "Reload from disk" throws away the unsaved edits that caused the conflict
  // (the buffer is dirty whenever this banner shows), so confirm first. "Keep
  // my changes" stays the no-data-loss escape hatch.
  const handleReloadFromDisk = useCallback(async () => {
    const confirmed = await confirm({
      title: "Discard your changes?",
      message: `${activeFilePath} has unsaved changes. Reload the version on disk and discard them?`,
      confirmLabel: "Reload and discard",
      cancelLabel: "Keep editing",
      danger: true,
    });
    if (confirmed) {
      void reloadActiveFile();
    }
  }, [confirm, reloadActiveFile, activeFilePath]);

  // Buffer not loaded yet (file is in the scan list, its contents are still
  // being read). EditorRegion already confirmed the file exists. The text is
  // invisible until ~150ms in (a CSS-delayed reveal), so a warm read swaps in
  // the editor before anything paints and only a slow read ever shows it.
  if (!bufferLoaded) {
    return (
      <div className="editor-body">
        <div className="empty-state empty-state--loading" aria-busy="true">
          <p className="empty-state__title">Loading file…</p>
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
            <button
              type="button"
              className="link-button"
              onClick={() => void handleReloadFromDisk()}
            >
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
