import type { EditorView } from "@codemirror/view";
import { CodeMirrorMarkdownEditor, pickImageFileForCaret, type EditorSelectionSnapshot } from "@latentic/live-markdown";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";

import { useUiStore } from "../../app/store/uiStore";
import { useWorkspaceLinkTargets } from "../../app/useWorkspaceLinkTargets";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { registerActiveEditorFlush } from "../../lib/editor/editorFlush";
import { writeBinaryFile } from "../../lib/ipc/filesClient";
import { openExternalUrl } from "../../lib/links/openExternal";
import { markdownToClipboardHtml } from "../../lib/markdown/markdownToClipboardHtml";
import { markBoot, markTabSwitchEnd } from "../../lib/perf";
import { ReviewChangesButton } from "../review/ReviewChangesButton";
import { reviewMargin } from "../review/reviewExtension";
import { ReviewMargin } from "../review/ReviewMargin";
import { useAgentName, useReviewInputs } from "../review/useReviewInputs";
import { showToast } from "../toast/toastStore";
import { CodeMirrorToolbar } from "./CodeMirrorToolbar";
import { CommentBubble } from "./CommentBubble";
import { TableCommentComposer, useSelectionComments, useTableComment } from "./DocumentComments";
import { documentStyle } from "./documentStyle";
import { markDocumentSurfaceMounted } from "./documentSurface";
import { EditorFileActions, type DocumentExportFormat } from "./EditorFileActions";
import { imageWritePath, resolveDisplaySrc } from "./imagePaths";
import { PlainTextEditor } from "./PlainTextEditor";
import { useDocumentExport } from "./useDocumentExport";
import { useImageAltPrompt } from "./useImageAltPrompt";
import { useShownDocument } from "./useShownDocument";
import { useShownFileUpdate } from "./useShownFileUpdate";

/**
 * How long after the last edit the active file is auto-written to disk. Stacks
 * on the editor's own 500ms buffer debounce, so a disk write lands ~1.5s after
 * you stop typing — frequent enough that edits are safe, rare enough not to
 * thrash the filesystem.
 */
const AUTOSAVE_TO_DISK_MS = 1000;

const DOCUMENT_EXTENSIONS = [documentStyle, reviewMargin];

/**
 * Write the note to disk a second after the last change. `saveActiveFile`
 * flushes the editor first, so this saves exactly what is on screen; once
 * saved the note is no longer dirty and nothing more is scheduled.
 */
function useAutosave(content: string, dirty: boolean) {
  const saveActiveFile = useWorkspaceStore((state) => state.saveActiveFile);
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void saveActiveFile({ implicit: true }), AUTOSAVE_TO_DISK_MS);
    return () => window.clearTimeout(timer);
  }, [content, dirty, saveActiveFile]);
}

/**
 * Save a pasted or dropped image beside the note, in its workspace. An
 * external file has no workspace to hold it: the write would land in the
 * open workspace and the inserted link would point nowhere.
 */
function useSaveImageBytes(workspaceId: string | null, filePath: string, enabled: boolean) {
  return useCallback(
    async (relativePath: string, bytes: Uint8Array) => {
      if (!enabled) {
        showToast({ kind: "error", title: "Not available", message: "Images can't be inserted into external files yet." });
        throw new Error("image insert unavailable for external files");
      }
      await writeBinaryFile(workspaceId ?? "preview", imageWritePath(filePath, relativePath), bytes);
    },
    [workspaceId, filePath, enabled],
  );
}

/** The boot profile's last phase: the note is on screen, and the launch was holding the window for it. */
function useMarkDocumentShown() {
  useEffect(() => {
    markBoot("doc");
    markDocumentSurfaceMounted();
  }, []);
}

interface FileActionsInput {
  readonly plainText: boolean;
  readonly commentsEnabled: boolean;
  readonly commentCount: number;
  readonly onExport: (format: DocumentExportFormat) => void;
  readonly onShowVersionHistory?: () => void;
}

/**
 * The note's own actions, beside the formatting: save, history, export,
 * comments and chat. Built once per change of these, not per keystroke, so
 * the editor's toolbar memo holds.
 */
function useFileActions({ plainText, commentsEnabled, commentCount, onExport, onShowVersionHistory }: FileActionsInput): ReactNode {
  const saveActiveFile = useWorkspaceStore((state) => state.saveActiveFile);
  const commentsOpen = useUiStore((state) => state.commentsOpen);
  const chatOpen = useUiStore((state) => state.chatOpen);
  const toggleComments = useUiStore((state) => state.toggleComments);
  const toggleChat = useUiStore((state) => state.toggleChat);
  return useMemo(
    () => (
      <>
        <EditorFileActions
          onSave={saveActiveFile}
          onShowVersionHistory={onShowVersionHistory}
          onExport={onExport}
          markdownExport={!plainText}
          onToggleComments={commentsEnabled ? toggleComments : undefined}
          commentsOpen={commentsOpen}
          commentCount={commentCount}
          onToggleChat={toggleChat}
          chatOpen={chatOpen}
        />
        {plainText ? null : <ReviewChangesButton />}
      </>
    ),
    [saveActiveFile, onShowVersionHistory, onExport, plainText, toggleComments, commentsOpen, commentCount, toggleChat, chatOpen, commentsEnabled],
  );
}

interface DocumentToolbarProps {
  readonly view: EditorView;
  readonly mode: "wysiwyg" | "source";
  readonly fileActions: ReactNode;
  readonly linkTargets: Set<string>;
}

/** Compose's toolbar over the note; Insert image runs the editor's own picker on the live view. */
function DocumentToolbar({ view, mode, fileActions, linkTargets }: DocumentToolbarProps) {
  const insertImage = useCallback(() => pickImageFileForCaret(view), [view]);
  return <CodeMirrorToolbar view={view} mode={mode} fileActions={fileActions} linkTargets={linkTargets} onInsertImage={insertImage} />;
}

/**
 * The markdown editor, bound to the active file's buffer. It is the only
 * component that reads the note's content, so a keystroke re-renders here and
 * nowhere else: not the {@link ActiveDocument} shell, the version history,
 * the conflict banner or the comments panel.
 *
 * Re-rendering per keystroke is intrinsic: the editor is controlled (`value`
 * is the live content), and CodeMirror's own loop guard skips the sync when
 * the change came from the editor.
 */
export function DocumentEditor({ onShowVersionHistory }: { onShowVersionHistory?: () => void }) {
  const note = useShownDocument();
  const updateShownContent = useShownFileUpdate(note.focusedWorkspaceId, note.activeFilePath);
  const editorMode = useUiStore((state) => state.editorMode);
  // Focus mode leaves the formatting toolbar out: the editor renders bare.
  const focusMode = useUiStore((state) => state.focusMode);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const linkTargets = useWorkspaceLinkTargets();
  const agentName = useAgentName();
  const { askAgent, keepComment } = useSelectionComments();
  const tableComment = useTableComment(note.commentsEnabled);
  const { exportNote, dialog: exportDialog } = useDocumentExport();
  const saveImageBytes = useSaveImageBytes(note.activeWorkspaceId, note.activeFilePath, note.imageInsertEnabled);
  const fileActions = useFileActions({
    plainText: note.plainText,
    commentsEnabled: note.commentsEnabled,
    commentCount: note.openComments.length,
    onExport: exportNote,
    onShowVersionHistory,
  });

  useImageAltPrompt();
  useMarkDocumentShown();
  useAutosave(note.content, note.dirty);
  useReviewInputs(note.plainText ? "" : note.activeFilePath, agentName);

  const navigateToFile = useCallback((path: string) => void selectFile(path), [selectFile]);
  const toolbar = useCallback(
    ({ view }: { view: EditorView }) => <DocumentToolbar view={view} mode={editorMode} fileActions={fileActions} linkTargets={linkTargets} />,
    [editorMode, fileActions, linkTargets],
  );
  // No bubble on an external file: comments and agent context belong to a workspace.
  const selectionActions = useCallback(
    ({ selection, dismiss }: { selection: EditorSelectionSnapshot | null; dismiss: () => void }) =>
      note.commentsEnabled ? (
        <CommentBubble hasEditor selection={selection} dismissSelection={dismiss} onSendToChat={askAgent} onQueueComment={keepComment} />
      ) : null,
    [askAgent, keepComment, note.commentsEnabled],
  );
  // A plain-text file keeps the file actions but none of the formatting.
  const plainTextToolbar = useMemo(() => <CodeMirrorToolbar view={null} mode="source" fileActions={fileActions} />, [fileActions]);

  if (note.plainText) {
    return (
      <>
        <PlainTextEditor
          key={note.activeFilePath}
          value={note.content}
          onChange={updateShownContent}
          onFlushReady={registerActiveEditorFlush}
          onAfterContentSwap={markTabSwitchEnd}
          toolbar={focusMode ? undefined : plainTextToolbar}
        />
        {exportDialog}
      </>
    );
  }

  return (
    <>
      <CodeMirrorMarkdownEditor
        mode={editorMode}
        extensions={DOCUMENT_EXTENSIONS}
        value={note.content}
        workspaceRoot={note.workspacePath ?? undefined}
        filePath={note.activeFilePath || undefined}
        linkTargets={linkTargets}
        onNavigateToLink={navigateToFile}
        onChange={updateShownContent}
        toolbar={focusMode ? undefined : toolbar}
        selectionActions={selectionActions}
        resolveImageSrc={resolveDisplaySrc}
        saveImageBytes={saveImageBytes}
        onOpenExternalUrl={openExternalUrl}
        onCommentOnExcerpt={tableComment.openComment}
        renderClipboardHtml={markdownToClipboardHtml}
        onAfterContentSwap={markTabSwitchEnd}
        onFlushReady={registerActiveEditorFlush}
      />
      <ReviewMargin agentName={agentName} />
      {exportDialog}
      {tableComment.open ? (
        <TableCommentComposer
          excerpt={tableComment.open.excerpt}
          anchor={tableComment.open.anchor}
          onAsk={askAgent}
          onKeep={keepComment}
          onClose={tableComment.close}
        />
      ) : null}
    </>
  );
}
