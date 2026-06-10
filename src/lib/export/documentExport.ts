import { isTauriRuntime } from "../runtime/desktopRuntime";

/**
 * The shared "save a generated document" flow used by every export format:
 * prompt for a location, run the backend export, then open the result. Each
 * format (PDF, HTML, …) supplies only its filename/filter and the command that
 * produces the file.
 */

export type FileExportResult =
  | { status: "exported"; path: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/** Derive a default export filename from a workspace-relative markdown path. */
export function defaultExportFileName(relativePath: string, extension: string): string {
  const base = relativePath.split("/").pop() ?? "document";
  return `${base.replace(/\.md$/i, "")}.${extension}`;
}

/**
 * Prompt for a save location, run `produce(destinationPath)`, then open the
 * result in the default app. Never throws — returns a discriminated result the
 * caller turns into UI feedback.
 */
export async function saveDocumentExport(options: {
  defaultFileName: string;
  filterName: string;
  extension: string;
  produce: (destinationPath: string) => Promise<{ path: string }>;
}): Promise<FileExportResult> {
  if (!isTauriRuntime()) {
    return { status: "error", message: "Exporting is available in the desktop app." };
  }
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const destinationPath = await save({
      defaultPath: options.defaultFileName,
      filters: [{ name: options.filterName, extensions: [options.extension] }],
    });
    if (!destinationPath) {
      return { status: "cancelled" };
    }
    const artifact = await options.produce(destinationPath);
    // Opening the result is a nicety — never let it fail the export.
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(artifact.path);
    } catch {
      /* the file was written; viewer launch is best-effort */
    }
    return { status: "exported", path: artifact.path };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not export the document.",
    };
  }
}
