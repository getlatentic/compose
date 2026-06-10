import { exportPdf } from "../ipc/exportClient";
import {
  defaultExportFileName,
  saveDocumentExport,
  type FileExportResult,
} from "./documentExport";

/**
 * "Export to PDF": prompt for a location, render the PDF in the backend (macOS
 * WebKit), then open it. The dialog/open choreography lives in
 * {@link saveDocumentExport}; this just supplies the PDF specifics.
 */
export async function exportDocumentToPdf(args: {
  workspaceId: string;
  relativePath: string;
  content: string;
}): Promise<FileExportResult> {
  return saveDocumentExport({
    defaultFileName: defaultExportFileName(args.relativePath, "pdf"),
    filterName: "PDF",
    extension: "pdf",
    produce: (destinationPath) => exportPdf({ ...args, destinationPath }),
  });
}
