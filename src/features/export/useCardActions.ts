import { useCallback, useRef, useState } from "react";

import { defaultExportFileName, saveDocumentExport, type FileExportResult } from "../../lib/export/documentExport";
import { exportCardImage, type CardSpec, type ImageFormat } from "../../lib/ipc/cardExportClient";
import { FORMAT_FILES } from "./cardOptions";
import { copyCard, postCardOnX, shareCard } from "./cardSharing";

interface CardActionsInput {
  readonly spec: CardSpec;
  readonly format: ImageFormat;
  readonly filePath: string;
  readonly onResult: (result: FileExportResult) => void;
  readonly onClose: () => void;
}

/**
 * Save, copy, share and post: one at a time, with the buttons disabled while
 * one runs, and enabled again however it ends.
 */
export function useCardActions({ spec, format, filePath, onResult, onClose }: CardActionsInput) {
  const [busy, setBusy] = useState(false);
  const shareButton = useRef<HTMLButtonElement | null>(null);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }, []);

  const save = useCallback(async () => {
    const { extension, filterName } = FORMAT_FILES[format];
    const result = await saveDocumentExport({
      defaultFileName: defaultExportFileName(filePath, extension),
      filterName,
      extension,
      produce: (destination) => exportCardImage(spec, format, destination),
    });
    if (result.status === "cancelled") return;
    onResult(result);
    if (result.status === "exported") onClose();
  }, [filePath, format, spec, onResult, onClose]);

  const saveClick = useCallback(() => void run(save), [run, save]);
  const copyClick = useCallback(() => void run(async () => void (await copyCard(spec))), [run, spec]);
  const postClick = useCallback(() => void run(() => postCardOnX(spec)), [run, spec]);
  const shareClick = useCallback(() => {
    const rect = shareButton.current?.getBoundingClientRect();
    if (!rect) return;
    const anchor = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    void run(() => shareCard(spec, defaultExportFileName(filePath, FORMAT_FILES.png.extension), anchor));
  }, [run, spec, filePath]);

  return { busy, shareButton, saveClick, copyClick, postClick, shareClick };
}
