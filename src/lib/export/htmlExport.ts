import { exportHtml } from "../ipc/exportClient";
import {
  defaultExportFileName,
  saveDocumentExport,
  type FileExportResult,
} from "./documentExport";
import { documentRefPath, type DocumentRef } from "../../app/workspaceModel";
import type { ExportTypefaces } from "../theme/exportTypefaces";

/**
 * "Export to HTML": prompt for a location, render a standalone HTML document in
 * the backend (the same `export::html` renderer the PDF path uses — GFM, a
 * print stylesheet, images inlined as data URIs), then open it. No external
 * dependency, works on every platform.
 */
export async function exportDocumentToHtml(args: {
  document: DocumentRef;
  content: string;
  typefaces?: ExportTypefaces;
}): Promise<FileExportResult> {
  return saveDocumentExport({
    defaultFileName: defaultExportFileName(documentRefPath(args.document), "html"),
    filterName: "HTML",
    extension: "html",
    produce: (destinationPath) => exportHtml({ ...args, destinationPath }),
  });
}
