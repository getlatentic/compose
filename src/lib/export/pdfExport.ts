import { exportPdf } from "../ipc/exportClient";
import {
  defaultExportFileName,
  saveDocumentExport,
  type FileExportResult,
} from "./documentExport";
import { documentRefPath, type DocumentRef } from "../../app/workspaceModel";

/**
 * "Export to PDF": prompt for a location, render the PDF in the backend (macOS
 * WebKit), then open it. The dialog/open choreography lives in
 * {@link saveDocumentExport}; this just supplies the PDF specifics.
 */
export async function exportDocumentToPdf(args: {
  document: DocumentRef;
  content: string;
}): Promise<FileExportResult> {
  return saveDocumentExport({
    defaultFileName: defaultExportFileName(documentRefPath(args.document), "pdf"),
    filterName: "PDF",
    extension: "pdf",
    produce: (destinationPath) => exportPdf({ ...args, destinationPath }),
  });
}
