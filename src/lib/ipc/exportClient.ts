import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import { collectMermaidSvgs } from "../export/mermaidSvgs";

/**
 * Document-export IPC leaf (see `compose::export`). Both formats render the
 * document's current markdown to a self-contained HTML document (GFM + a print
 * stylesheet + inlined images); HTML writes that directly (any platform), PDF
 * hands it to macOS WebKit (desktop + macOS only).
 */

/** A generated export artifact returned by the backend. */
export interface ExportArtifact {
  format: "pdf" | "html";
  /** Absolute path the artifact was written to. */
  path: string;
}

interface ExportArgs {
  workspaceId: string;
  relativePath: string;
  /** The document's current (possibly-unsaved) markdown. */
  content: string;
  /** Absolute save location chosen by the user. */
  destinationPath: string;
}

/** Pre-render the document's mermaid diagrams to SVG so the backend can inline
 *  them (there is no Rust mermaid renderer). See {@link collectMermaidSvgs}. */
async function exportInvokeArgs(args: ExportArgs) {
  return {
    workspaceId: args.workspaceId,
    relativePath: args.relativePath,
    content: args.content,
    destinationPath: args.destinationPath,
    mermaidSvgs: await collectMermaidSvgs(args.content),
  };
}

/** Render `content` to a PDF at `destinationPath` (macOS WebKit). */
export async function exportPdf(args: ExportArgs): Promise<ExportArtifact> {
  if (!isTauriRuntime()) {
    throw new Error("PDF export is available in the desktop app.");
  }
  return invoke<ExportArtifact>("workspace_export_pdf", await exportInvokeArgs(args));
}

/** Render `content` to a standalone HTML file at `destinationPath`. */
export async function exportHtml(args: ExportArgs): Promise<ExportArtifact> {
  if (!isTauriRuntime()) {
    throw new Error("HTML export is available in the desktop app.");
  }
  return invoke<ExportArtifact>("workspace_export_html", await exportInvokeArgs(args));
}
