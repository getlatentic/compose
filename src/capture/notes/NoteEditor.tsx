import { memo, useCallback, useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { CodeMirrorMarkdownEditor } from "@latentic/live-markdown";

import { resolveDisplaySrc } from "../../features/editor/imagePaths";
import { openExternalUrl } from "../../lib/links/openExternal";
import { markdownToClipboardHtml } from "../../lib/markdown/markdownToClipboardHtml";
import type { CaptureApi, QuickNote } from "../captureApi";
import { QuickNoteToolbar } from "./QuickNoteToolbar";

/** The name a quick note's images resolve against, in its own folder. */
const NOTE_FILE = "quick-note.md";

export interface NoteEditorProps {
  api: CaptureApi;
  note: QuickNote;
  onChange(id: string, body: string): void;
  /** The editor, once it exists, for inserting into it and reading its text. */
  onView(view: EditorView | null): void;
  /** Pulls text typed a moment ago into `onChange` at once; `null` when gone. */
  onFlush(flush: (() => void) | null): void;
}

/**
 * One quick note in the editor the main window uses: Markdown shown formatted,
 * pasted formatting kept, images kept in the note's own folder until it is saved.
 */
function NoteEditorInner({ api, note, onChange, onView, onFlush }: NoteEditorProps) {
  const [folder, setFolder] = useState<string | undefined>(undefined);
  const id = note.id;

  useEffect(() => {
    let cancelled = false;
    api.noteFolder(id).then(
      (path) => {
        if (!cancelled) setFolder(path);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  useEffect(() => () => onView(null), [onView]);

  const change = useCallback((body: string) => onChange(id, body), [id, onChange]);
  const saveImageBytes = useCallback((relativePath: string, bytes: Uint8Array) => api.keepImage(id, relativePath, bytes), [api, id]);
  const toolbar = useCallback(
    ({ view }: { view: EditorView }) => {
      onView(view);
      return <QuickNoteToolbar view={view} />;
    },
    [onView],
  );

  return (
    <CodeMirrorMarkdownEditor
      mode="wysiwyg"
      value={note.body}
      workspaceRoot={folder}
      filePath={NOTE_FILE}
      onChange={change}
      toolbar={toolbar}
      resolveImageSrc={resolveDisplaySrc}
      saveImageBytes={saveImageBytes}
      onOpenExternalUrl={openExternalUrl}
      renderClipboardHtml={markdownToClipboardHtml}
      onFlushReady={onFlush}
    />
  );
}

export const NoteEditor = memo(NoteEditorInner);
