import { isTauriRuntime } from "../runtime/desktopRuntime";
import { withoutDocumentExtension } from "../documents/documentKind";

/**
 * The shared "save a generated document" flow used by every export format:
 * prompt for a location, then run the backend export. Each
 * format (PDF, HTML, …) supplies only its filename/filter and the command that
 * produces the file.
 */

export type FileExportResult =
  | { status: "exported"; path: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/** Derive a default export filename from the document's path. */
export function defaultExportFileName(relativePath: string, extension: string): string {
  const base = relativePath.split("/").pop() ?? "document";
  return `${withoutDocumentExtension(base)}.${extension}`;
}

/**
 * Prompt for a save location, then run `produce(destinationPath)`. Never throws — returns a discriminated result the
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
    return { status: "exported", path: artifact.path };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not export the document.",
    };
  }
}

/** Opens a Finder window with the saved file selected. */
export async function revealExport(path: string): Promise<void> {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

/**
 * The toast for an export's outcome: where the file went, with a way to find
 * it, or why it failed. A cancelled Save dialog says nothing.
 */
export function reportExportResult(result: FileExportResult, show: (toast: ExportToast) => void): void {
  if (result.status === "cancelled") return;
  if (result.status === "error") {
    show({ kind: "error", title: "Export failed", message: result.message });
    return;
  }
  const name = result.path.split("/").pop() ?? result.path;
  show({
    kind: "success",
    title: "Exported",
    message: `Saved “${name}”.`,
    timeoutMs: 10000,
    action: { label: "Show in Finder", run: () => void revealExport(result.path) },
  });
}

export interface ExportToast {
  kind: "success" | "error";
  title: string;
  message: string;
  timeoutMs?: number;
  action?: { label: string; run: () => void };
}
