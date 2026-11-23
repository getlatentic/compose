import { useCallback, useEffect, useMemo, useState } from "react";

import { useUiStore } from "../../app/store/uiStore";
import type { DocumentRef } from "../../app/workspaceModel";
import { cardColorsFrom, cardColorsOn, type CardColors } from "../../lib/export/cardColors";
import { cardContentFor, type CardContent } from "../../lib/export/cardContent";
import { reportClientError } from "../../lib/diagnostics/errorReporter";
import { cardPreviewHtml, type CardLayout, type CardSize, type CardSpec } from "../../lib/ipc/cardExportClient";
import { exportTypefacesFor } from "../../lib/theme/exportTypefaces";
import { SWATCHES, type CardBackground } from "./cardOptions";

const PREVIEW_DELAY_MS = 200;

export interface CardSource {
  readonly markdown: string;
  readonly filePath: string;
  /** Selected text, for a quote card. */
  readonly selection: string;
  /** The note the card comes from, so a page card's images are found. */
  readonly document?: DocumentRef;
}

/** The card the writer is shaping, and the setters for each choice. */
export function useImageCard({ markdown, filePath, selection, document: source }: CardSource) {
  const [layout, setLayout] = useState<CardLayout>(selection ? "quote" : "page");
  const [size, setSize] = useState<CardSize>("portrait");
  const [showMark, setShowMark] = useState(true);
  const [content, setContent] = useState<CardContent>(() => cardContentFor(markdown, filePath, selection));
  const [noteColors] = useState<CardColors>(() => cardColorsFrom(document.querySelector(".editor-region") ?? document.body));
  const [background, setBackground] = useState<CardBackground>("note");
  const [cardColor, setCardColor] = useState(SWATCHES[0].color);

  const noteBackground = useUiStore((state) => state.noteBackground);
  const palette = useUiStore((state) => state.palette);
  const readingFont = useUiStore((state) => state.readingFont);
  const customFont = useUiStore((state) => state.customFont);
  const exportFont = useUiStore((state) => state.exportFont);

  const spec = useMemo<CardSpec>(() => {
    const likeNote = background === "note";
    return {
      layout,
      size,
      content,
      colors: likeNote ? noteColors : cardColorsOn(cardColor),
      image: likeNote && noteBackground.kind === "image" ? { file: noteBackground.file, dim: noteBackground.dim } : undefined,
      typefaces: exportTypefacesFor({ palette, readingFont, customFont, exportFont }),
      showMark,
      document: source,
    };
  }, [layout, size, content, noteColors, background, cardColor, noteBackground, palette, readingFont, customFont, exportFont, showMark, source]);

  const changeField = useCallback(
    (key: keyof CardContent, value: string) => setContent((current) => ({ ...current, [key]: value })),
    [],
  );

  return {
    spec,
    layout,
    setLayout,
    size,
    setSize,
    showMark,
    setShowMark,
    content,
    changeField,
    background,
    setBackground,
    cardColor,
    setCardColor,
  };
}

/** What the preview shows: the card's HTML, or why there is none. */
export type CardPreview =
  | { readonly kind: "drawing" }
  | { readonly kind: "ready"; readonly html: string }
  /** Outside the Compose app there is no renderer. */
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed" };

/** The card's HTML for the preview, redrawn a beat after the last change. */
export function useCardPreview(spec: CardSpec): CardPreview {
  const [preview, setPreview] = useState<CardPreview>({ kind: "drawing" });
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      cardPreviewHtml(spec).then(
        (html) => {
          if (live) setPreview(html === null ? { kind: "unavailable" } : { kind: "ready", html });
        },
        (error: unknown) => {
          if (!live) return;
          setPreview({ kind: "failed" });
          void reportClientError("card-preview", "Could not draw the image preview", String(error));
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [spec]);
  return preview;
}
