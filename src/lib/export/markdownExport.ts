import { exportMarkdown } from "../ipc/exportClient";
import { saveDocumentExport, type FileExportResult } from "./documentExport";

export interface MarkdownExportRequest {
  filePath: string;
  markdown: string;
}

export function markdownExportFileName(filePath: string) {
  const fallbackName = "untitled.md";
  const leafName = filePath.split(/[\\/]/).filter(Boolean).pop()?.trim();
  if (!leafName) {
    return fallbackName;
  }

  const safeName = leafName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
  return safeName.endsWith(".md") ? safeName : `${safeName}.md`;
}

/** Asks where to save the markdown, then writes it there. */
export function exportMarkdownFile({ filePath, markdown }: MarkdownExportRequest): Promise<FileExportResult> {
  return saveDocumentExport({
    defaultFileName: markdownExportFileName(filePath),
    filterName: "Markdown",
    extension: "md",
    produce: (destinationPath) => exportMarkdown({ content: markdown, destinationPath }),
  });
}
