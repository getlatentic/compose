import { exportPdf } from "../ipc/exportClient";
import { isTauriRuntime } from "../runtime/desktopRuntime";

/**
 * Orchestrates "Export to PDF": prompt for a save location, render the PDF in
 * the backend, then open the result in the default viewer. Kept out of the
 * shell component so the dialog/opener choreography lives in one testable place.
 */

export type PdfExportResult =
  | { status: "exported"; path: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/** Derive a sensible default PDF filename from a workspace-relative path. */
export function defaultPdfFileName(relativePath: string): string {
  const base = relativePath.split("/").pop() ?? "document";
  return `${base.replace(/\.md$/i, "")}.pdf`;
}

/**
 * Run the full export flow for one document. Never throws — it returns a
 * discriminated result the caller can turn into UI feedback.
 */
export async function exportDocumentToPdf(args: {
  workspaceId: string;
  relativePath: string;
  content: string;
}): Promise<PdfExportResult> {
  if (!isTauriRuntime()) {
    return {
      status: "error",
      message: "PDF export is available in the desktop app.",
    };
  }
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const destinationPath = await save({
      defaultPath: defaultPdfFileName(args.relativePath),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!destinationPath) {
      return { status: "cancelled" };
    }
    const artifact = await exportPdf({ ...args, destinationPath });
    // Opening the finished PDF is a nicety — never let it fail the export.
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(artifact.path);
    } catch {
      /* the PDF was written; viewer launch is best-effort */
    }
    return { status: "exported", path: artifact.path };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not export the PDF.",
    };
  }
}
