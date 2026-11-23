import { useCallback, useState, type ReactNode } from "react";

import type { DocumentRef } from "../../app/workspaceModel";
import type { FileExportResult } from "../../lib/export/documentExport";
import { ImageExportDialog } from "./ImageExportDialog";

export interface ImageExportRequest {
  readonly markdown: string;
  readonly filePath: string;
  readonly selection: string;
  readonly document?: DocumentRef;
}

/**
 * The "Export as image" dialog's open state, for the editor that offers it:
 * `open` takes the note as it is now; `dialog` is what to render.
 */
export function useImageExport(onResult: (result: FileExportResult) => void): {
  open: (request: ImageExportRequest) => void;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<ImageExportRequest | null>(null);
  const close = useCallback(() => setRequest(null), []);
  const dialog = request ? <ImageExportDialog {...request} onClose={close} onResult={onResult} /> : null;
  return { open: setRequest, dialog };
}
