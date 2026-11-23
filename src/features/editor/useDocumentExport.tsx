import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, type ReactNode } from "react";

import { useUiStore } from "../../app/store/uiStore";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { documentRef, type DocumentRef } from "../../app/workspaceModel";
import { reportExportResult, type FileExportResult } from "../../lib/export/documentExport";
import { exportDocumentToHtml } from "../../lib/export/htmlExport";
import { exportMarkdownFile } from "../../lib/export/markdownExport";
import { exportDocumentToPdf } from "../../lib/export/pdfExport";
import { printDocument } from "../../lib/export/printDocument";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { exportTypefacesFor } from "../../lib/theme/exportTypefaces";
import { useImageExport } from "../export/useImageExport";
import { showToast } from "../toast/toastStore";
import { activeEditorView } from "./editorChrome";
import type { DocumentExportFormat } from "./EditorFileActions";

interface ShownNote {
  readonly document: DocumentRef;
  readonly filePath: string;
  readonly content: string;
}

/**
 * The note the editor shows, read from the store when an action runs rather
 * than from the per-keystroke buffer, so the actions stay referentially stable.
 */
function shownNote(): ShownNote | null {
  const workspace = useWorkspaceStore.getState().focusedWorkspace();
  const filePath = workspace?.activeFilePath;
  const buffer = filePath ? workspace.fileContents[filePath] : undefined;
  if (!workspace || !filePath || !buffer) return null;
  return { document: documentRef(workspace, filePath), filePath, content: buffer.content };
}

function selectedText(): string {
  const view = activeEditorView.get();
  const range = view?.state.selection.main;
  return view && range && !range.empty ? view.state.sliceDoc(range.from, range.to) : "";
}

function reportExport(result: FileExportResult): void {
  reportExportResult(result, showToast);
}

async function printShownNote(): Promise<void> {
  const note = shownNote();
  if (!note) return;
  try {
    await printDocument({ document: note.document, content: note.content, typefaces: exportTypefacesFor(useUiStore.getState()) });
  } catch (error) {
    showToast({ kind: "error", title: "Print failed", message: String(error) });
  }
}

/**
 * Export and print for the shown note: Markdown, HTML and PDF through the
 * Save dialog, an image through its own dialog, and File → Print (⌘P, a
 * native menu item that emits `menu://print`) through the system panel.
 */
export function useDocumentExport(): { exportNote: (format: DocumentExportFormat) => Promise<void>; dialog: ReactNode } {
  const imageExport = useImageExport(reportExport);
  const openImageExport = imageExport.open;

  const exportNote = useCallback(
    async (format: DocumentExportFormat) => {
      const note = shownNote();
      if (!note) return;
      if (format === "image") {
        openImageExport({ markdown: note.content, filePath: note.filePath, selection: selectedText(), document: note.document });
        return;
      }
      if (format === "markdown") {
        reportExport(await exportMarkdownFile({ filePath: note.filePath, markdown: note.content }));
        return;
      }
      const exporter = format === "html" ? exportDocumentToHtml : exportDocumentToPdf;
      reportExport(await exporter({ document: note.document, content: note.content, typefaces: exportTypefacesFor(useUiStore.getState()) }));
    },
    [openImageExport],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen("menu://print", () => void printShownNote());
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  return { exportNote, dialog: imageExport.dialog };
}
