import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";

/**
 * Document-export IPC leaf. Backs "Export to PDF": the document's current
 * markdown is rendered to a self-contained HTML document and macOS WebKit
 * generates the PDF (see `compose::export`). Desktop + macOS only — the
 * browser preview has no native WebKit PDF path.
 */

/** A generated export artifact returned by the backend. */
export interface ExportArtifact {
  format: "pdf";
  /** Absolute path the artifact was written to. */
  path: string;
}

/** Render `content` to a PDF at `destinationPath`. */
export async function exportPdf(args: {
  workspaceId: string;
  relativePath: string;
  /** The document's current (possibly-unsaved) markdown. */
  content: string;
  /** Absolute save location chosen by the user. */
  destinationPath: string;
}): Promise<ExportArtifact> {
  if (!isTauriRuntime()) {
    throw new Error("PDF export is available in the desktop app.");
  }
  return invoke<ExportArtifact>("workspace_export_pdf", {
    workspaceId: args.workspaceId,
    relativePath: args.relativePath,
    content: args.content,
    destinationPath: args.destinationPath,
  });
}
