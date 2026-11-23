import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import { collectMermaidSvgs } from "../export/mermaidSvgs";
import type { DocumentRef } from "../../app/workspaceModel";
import type { ExportTypefaces } from "../theme/exportTypefaces";

/**
 * Document-export IPC leaf (see `compose::export`). Both formats render the
 * document's current markdown to a self-contained HTML document (GFM + a print
 * stylesheet + inlined images); HTML writes that directly (any platform), PDF
 * hands it to macOS WebKit (desktop + macOS only).
 */

/** A generated export artifact returned by the backend. */
export interface ExportArtifact {
  format: "pdf" | "html" | "image" | "markdown";
  /** Absolute path the artifact was written to. */
  path: string;
}

interface ExportArgs {
  document: DocumentRef;
  /** The document's current (possibly-unsaved) markdown. */
  content: string;
  /** Absolute save location chosen by the user. */
  destinationPath: string;
  /** The note's fonts; omitted for Latin Modern, the LaTeX look. */
  typefaces?: ExportTypefaces;
}

/** Pre-render the document's mermaid diagrams to SVG so the backend can inline
 *  them (there is no Rust mermaid renderer). See {@link collectMermaidSvgs}. */
async function exportInvokeArgs(args: ExportArgs) {
  return {
    document: args.document,
    content: args.content,
    destinationPath: args.destinationPath,
    mermaidSvgs: await collectMermaidSvgs(args.content),
    typefaces: args.typefaces ?? null,
  };
}

/** Render `content` to a PDF at `destinationPath` (macOS WebKit). */
export async function exportPdf(args: ExportArgs): Promise<ExportArtifact> {
  if (!isTauriRuntime()) {
    throw new Error("PDF export is available in the desktop app.");
  }
  return invoke<ExportArtifact>("document_export_pdf", await exportInvokeArgs(args));
}

/** Render `content` to a standalone HTML file at `destinationPath`. */
export async function exportHtml(args: ExportArgs): Promise<ExportArtifact> {
  if (!isTauriRuntime()) {
    throw new Error("HTML export is available in the desktop app.");
  }
  return invoke<ExportArtifact>("document_export_html", await exportInvokeArgs(args));
}

export async function exportMarkdown(args: { content: string; destinationPath: string }): Promise<ExportArtifact> {
  if (!isTauriRuntime()) {
    throw new Error("Markdown export is available in the desktop app.");
  }
  return invoke<ExportArtifact>("document_export_markdown", args);
}
