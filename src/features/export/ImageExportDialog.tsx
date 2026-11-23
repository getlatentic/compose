import { Close } from "@carbon/react/icons";
import { useEffect, useState } from "react";

import type { FileExportResult } from "../../lib/export/documentExport";
import { CARD_PIXELS, type CardSize, type ImageFormat } from "../../lib/ipc/cardExportClient";
import { ImageExportControls } from "./ImageExportControls";
import { useCardActions } from "./useCardActions";
import { useCardPreview, useImageCard, type CardPreview, type CardSource } from "./useImageCard";

const PREVIEW_WIDTH = 560;
const PREVIEW_HEIGHT = 380;

interface ImageExportDialogProps extends CardSource {
  readonly onClose: () => void;
  readonly onResult: (result: FileExportResult) => void;
}

/**
 * Export a note as an image to post: a cover, a quote or a page, at a social
 * network's size, in the note's fonts and colours. The preview is the same
 * HTML the image is drawn from.
 */
export function ImageExportDialog({ onClose, onResult, ...source }: ImageExportDialogProps) {
  const card = useImageCard(source);
  const [format, setFormat] = useState<ImageFormat>("jpeg");
  const preview = useCardPreview(card.spec);
  const actions = useCardActions({ spec: card.spec, format, filePath: source.filePath, onResult, onClose });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <section className="image-export" role="dialog" aria-modal="true" aria-labelledby="image-export-title">
        <header className="image-export__header">
          <h2 id="image-export-title">Export as image</h2>
          <button type="button" className="icon-button" aria-label="Close" title="Close" onClick={onClose}>
            <Close size={16} />
          </button>
        </header>
        <div className="image-export__body">
          <PreviewFrame preview={preview} size={card.size} />
          <ImageExportControls
            layout={card.layout}
            onLayout={card.setLayout}
            size={card.size}
            onSize={card.setSize}
            content={card.content}
            onField={card.changeField}
            background={card.background}
            onBackground={card.setBackground}
            cardColor={card.cardColor}
            onCardColor={card.setCardColor}
            showMark={card.showMark}
            onShowMark={card.setShowMark}
            format={format}
            onFormat={setFormat}
          />
        </div>
        <footer className="image-export__footer">
          <div className="image-export__share" role="group" aria-label="Share">
            <button type="button" className="image-export__secondary" onClick={actions.copyClick} disabled={actions.busy}>
              Copy image
            </button>
            <button
              ref={actions.shareButton}
              type="button"
              className="image-export__secondary"
              onClick={actions.shareClick}
              disabled={actions.busy}
            >
              Share…
            </button>
            <button type="button" className="image-export__secondary" onClick={actions.postClick} disabled={actions.busy}>
              Post on X
            </button>
          </div>
          <button type="button" className="image-export__secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="image-export__primary" onClick={actions.saveClick} disabled={actions.busy}>
            {actions.busy ? "Exporting…" : "Export…"}
          </button>
        </footer>
      </section>
    </div>
  );
}

const PREVIEW_MESSAGES: Record<Exclude<CardPreview["kind"], "ready">, string> = {
  drawing: "Drawing the preview…",
  unavailable: "The preview draws in the Compose app.",
  failed: "The preview could not be drawn.",
};

/** The card at its own size, scaled down to fit the dialog. */
function PreviewFrame({ preview, size }: { readonly preview: CardPreview; readonly size: CardSize }) {
  const [width, height] = CARD_PIXELS[size];
  const scale = Math.min(PREVIEW_WIDTH / width, PREVIEW_HEIGHT / height);
  return (
    <div className="image-export__preview" style={{ inlineSize: width * scale, blockSize: height * scale }}>
      {preview.kind === "ready" ? (
        <iframe
          title="Preview"
          sandbox="allow-scripts"
          srcDoc={preview.html}
          style={{ inlineSize: width, blockSize: height, transform: `scale(${scale})` }}
        />
      ) : (
        <p className="image-export__placeholder">{PREVIEW_MESSAGES[preview.kind]}</p>
      )}
    </div>
  );
}
