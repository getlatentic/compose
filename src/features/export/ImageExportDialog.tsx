import { Close } from "@carbon/react/icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import { useUiStore } from "../../app/store/uiStore";
import type { DocumentRef } from "../../app/workspaceModel";
import { cardColorsFrom, cardColorsOn, type CardColors } from "../../lib/export/cardColors";
import { cardContentFor, type CardContent } from "../../lib/export/cardContent";
import { defaultExportFileName, saveDocumentExport, type FileExportResult } from "../../lib/export/documentExport";
import {
  CARD_PIXELS,
  cardPreviewHtml,
  exportCardImage,
  type CardLayout,
  type CardSize,
  type CardSpec,
  type ImageFormat,
} from "../../lib/ipc/cardExportClient";
import { exportTypefacesFor } from "../../lib/theme/exportTypefaces";
import { ColorField } from "../shared/ColorField";
import { SegmentedControl, type SegmentOption } from "../shared/SegmentedControl";
import { copyCard, postCardOnX, shareCard } from "./cardSharing";

const LAYOUTS: readonly SegmentOption<CardLayout>[] = [
  { value: "cover", label: "Cover" },
  { value: "quote", label: "Quote" },
  { value: "page", label: "Page" },
];

const SIZES: readonly { value: CardSize; label: string }[] = [
  { value: "landscape", label: "X / Twitter · 1600 × 900" },
  { value: "portrait", label: "Portrait · 1080 × 1350" },
  { value: "square", label: "Square · 1080 × 1080" },
  { value: "story", label: "Story · 1080 × 1920" },
  { value: "wide", label: "LinkedIn · 1200 × 627" },
];

const FORMATS: readonly SegmentOption<ImageFormat>[] = [
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
];

/** The fields each layout shows, in order. */
const FIELDS: Record<CardLayout, readonly { key: keyof CardContent; label: string; multiline?: boolean }[]> = {
  cover: [
    { key: "eyebrow", label: "Label" },
    { key: "title", label: "Title" },
    { key: "author", label: "Author" },
    { key: "subtitle", label: "Subtitle" },
    { key: "date", label: "Date" },
  ],
  quote: [
    { key: "quote", label: "Passage", multiline: true },
    { key: "author", label: "Author" },
    { key: "title", label: "Source" },
  ],
  page: [],
};

type CardBackground = "note" | "color";

const BACKGROUNDS: readonly SegmentOption<CardBackground>[] = [
  { value: "note", label: "Like the note" },
  { value: "color", label: "Colour" },
];

/** A few starting colours; any other is a click or a hex code away. */
const SWATCHES: readonly { color: string; name: string }[] = [
  { color: "#f2cf4b", name: "Yellow" },
  { color: "#f4efe6", name: "Paper" },
  { color: "#dfe8d8", name: "Sage" },
  { color: "#dce9f5", name: "Sky" },
  { color: "#f6d5c8", name: "Coral" },
  { color: "#1c1b1a", name: "Ink" },
];

const PREVIEW_WIDTH = 560;
const PREVIEW_HEIGHT = 380;
const PREVIEW_DELAY_MS = 200;

interface ImageExportDialogProps {
  readonly markdown: string;
  readonly filePath: string;
  /** Selected text, for a quote card. */
  readonly selection: string;
  /** The note the card comes from, so a page card's images are found. */
  readonly document?: DocumentRef;
  readonly onClose: () => void;
  readonly onResult: (result: FileExportResult) => void;
}

/**
 * Export a note as an image to post: a cover, a quote or a page, at a social
 * network's size, in the note's fonts and colours. The preview is the same
 * HTML the image is drawn from.
 */
export function ImageExportDialog({ markdown, filePath, selection, document: source, onClose, onResult }: ImageExportDialogProps) {
  const [layout, setLayout] = useState<CardLayout>(selection ? "quote" : "page");
  const [size, setSize] = useState<CardSize>("portrait");
  const [showMark, setShowMark] = useState(true);
  const [format, setFormat] = useState<ImageFormat>("jpeg");
  const [content, setContent] = useState<CardContent>(() => cardContentFor(markdown, filePath, selection));
  const [noteColors] = useState<CardColors>(() => cardColorsFrom(document.querySelector(".editor-region") ?? document.body));
  const [background, setBackground] = useState<CardBackground>("note");
  const [cardColor, setCardColor] = useState(SWATCHES[0].color);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const appearance = useUiStore.getState();

  const spec = useMemo<CardSpec>(() => {
    const note = appearance.noteBackground;
    const likeNote = background === "note";
    return {
      layout,
      size,
      content,
      colors: likeNote ? noteColors : cardColorsOn(cardColor),
      image: likeNote && note.kind === "image" ? { file: note.file, dim: note.dim } : undefined,
      typefaces: exportTypefacesFor(appearance),
      showMark,
      document: source,
    };
  }, [layout, size, content, noteColors, background, cardColor, appearance, showMark, source]);

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void cardPreviewHtml(spec).then((html) => {
        if (live) setPreview(html);
      });
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [spec]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changeField = useCallback((key: keyof CardContent, value: string) => setContent((current) => ({ ...current, [key]: value })), []);
  const changeSize = useCallback((event: ChangeEvent<HTMLSelectElement>) => setSize(event.target.value as CardSize), []);

  const handleExport = useCallback(async () => {
    setBusy(true);
    const extension = format === "jpeg" ? "jpg" : "png";
    const result = await saveDocumentExport({
      defaultFileName: defaultExportFileName(filePath, extension),
      filterName: format === "jpeg" ? "JPEG image" : "PNG image",
      extension,
      produce: (destination) => exportCardImage(spec, format, destination),
    });
    setBusy(false);
    if (result.status === "cancelled") return;
    onResult(result);
    if (result.status === "exported") onClose();
  }, [filePath, format, spec, onResult, onClose]);
  const exportClick = useCallback(() => void handleExport(), [handleExport]);

  const shareButton = useRef<HTMLButtonElement | null>(null);
  const withBusy = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true);
    await work();
    setBusy(false);
  }, []);
  const copyClick = useCallback(() => void withBusy(() => copyCard(spec)), [withBusy, spec]);
  const postClick = useCallback(() => void withBusy(() => postCardOnX(spec)), [withBusy, spec]);
  const shareClick = useCallback(() => {
    const rect = shareButton.current?.getBoundingClientRect();
    if (!rect) return;
    const anchor = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    void withBusy(() => shareCard(spec, defaultExportFileName(filePath, "png"), anchor));
  }, [withBusy, spec, filePath]);
  const markChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setShowMark(event.target.checked), []);

  const [width, height] = CARD_PIXELS[size];
  const scale = Math.min(PREVIEW_WIDTH / width, PREVIEW_HEIGHT / height);

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
          <div className="image-export__preview" style={{ inlineSize: width * scale, blockSize: height * scale }}>
            {preview ? (
              <iframe
                title="Preview"
                sandbox="allow-scripts"
                srcDoc={preview}
                style={{ inlineSize: width, blockSize: height, transform: `scale(${scale})` }}
              />
            ) : (
              <p className="image-export__placeholder">The preview draws in the Compose app.</p>
            )}
          </div>
          <div className="image-export__controls">
            <div className="image-export__control">
              <span id="card-layout-label">Layout</span>
              <SegmentedControl name="card-layout" labelledBy="card-layout-label" options={LAYOUTS} value={layout} onChange={setLayout} />
            </div>
            <label className="image-export__control">
              <span>Size</span>
              <select value={size} onChange={changeSize}>
                {SIZES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {FIELDS[layout].map((field) => (
              <CardField key={field.key} field={field.key} label={field.label} multiline={field.multiline} value={content[field.key]} onChange={changeField} />
            ))}
            <div className="image-export__control">
              <span id="card-background-label">Background</span>
              <SegmentedControl name="card-background" labelledBy="card-background-label" options={BACKGROUNDS} value={background} onChange={setBackground} />
              {background === "color" ? (
                <div className="image-export__colors">
                  {SWATCHES.map((swatch) => (
                    <SwatchButton key={swatch.color} color={swatch.color} name={swatch.name} selected={swatch.color === cardColor} onPick={setCardColor} />
                  ))}
                  <ColorField value={cardColor} onChange={setCardColor} label="Card colour" />
                </div>
              ) : null}
            </div>
            <label className="image-export__check">
              <input type="checkbox" checked={showMark} onChange={markChange} />
              <span>Compose mark</span>
            </label>
            <div className="image-export__control">
              <span id="card-format-label">Format</span>
              <SegmentedControl name="card-format" labelledBy="card-format-label" options={FORMATS} value={format} onChange={setFormat} />
            </div>
          </div>
        </div>
        <footer className="image-export__footer">
          <div className="image-export__share" role="group" aria-label="Share">
            <button type="button" className="image-export__secondary" onClick={copyClick} disabled={busy}>
              Copy image
            </button>
            <button ref={shareButton} type="button" className="image-export__secondary" onClick={shareClick} disabled={busy}>
              Share…
            </button>
            <button type="button" className="image-export__secondary" onClick={postClick} disabled={busy}>
              Post on X
            </button>
          </div>
          <button type="button" className="image-export__secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="image-export__primary" onClick={exportClick} disabled={busy}>
            {busy ? "Exporting…" : "Export…"}
          </button>
        </footer>
      </section>
    </div>
  );
}

interface SwatchButtonProps {
  readonly color: string;
  readonly name: string;
  readonly selected: boolean;
  readonly onPick: (color: string) => void;
}

function SwatchButton({ color, name, selected, onPick }: SwatchButtonProps) {
  const pick = useCallback(() => onPick(color), [onPick, color]);
  return (
    <button
      type="button"
      className="image-export__swatch"
      style={{ background: color }}
      aria-label={name}
      aria-pressed={selected}
      title={name}
      onClick={pick}
    />
  );
}

interface CardFieldProps {
  readonly field: keyof CardContent;
  readonly label: string;
  readonly multiline?: boolean;
  readonly value: string;
  readonly onChange: (field: keyof CardContent, value: string) => void;
}

function CardField({ field, label, multiline, value, onChange }: CardFieldProps) {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(field, event.target.value),
    [field, onChange],
  );
  return (
    <label className="image-export__control">
      <span>{label}</span>
      {multiline ? <textarea rows={4} value={value} onChange={handleChange} /> : <input type="text" value={value} onChange={handleChange} />}
    </label>
  );
}
