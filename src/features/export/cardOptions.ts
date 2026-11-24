import type { CardContent } from "../../lib/export/cardContent";
import type { CardLayout, CardSize, ImageFormat } from "../../lib/ipc/cardExportClient";
import type { SegmentOption } from "../shared/SegmentedControl";

/** What the image dialog offers: layouts, sizes, formats and colours. */

export const LAYOUTS: readonly SegmentOption<CardLayout>[] = [
  { value: "cover", label: "Cover" },
  { value: "quote", label: "Quote" },
  { value: "page", label: "Page" },
];

export const SIZES: readonly { value: CardSize; label: string }[] = [
  { value: "landscape", label: "X / Twitter · 1600 × 900" },
  { value: "portrait", label: "Portrait · 1080 × 1350" },
  { value: "square", label: "Square · 1080 × 1080" },
  { value: "story", label: "Story · 1080 × 1920" },
  { value: "wide", label: "LinkedIn · 1200 × 627" },
];

export const FORMATS: readonly SegmentOption<ImageFormat>[] = [
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
];

export const FORMAT_FILES: Record<ImageFormat, { extension: string; filterName: string }> = {
  jpeg: { extension: "jpg", filterName: "JPEG image" },
  png: { extension: "png", filterName: "PNG image" },
};

export interface CardFieldOption {
  readonly key: keyof CardContent;
  readonly label: string;
  readonly multiline?: boolean;
}

/** The fields each layout shows, in order. */
export const FIELDS: Record<CardLayout, readonly CardFieldOption[]> = {
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

export type CardBackground = "note" | "color";

export const BACKGROUNDS: readonly SegmentOption<CardBackground>[] = [
  { value: "note", label: "Like the note" },
  { value: "color", label: "Colour" },
];

/** A few starting colours; any other is a click or a hex code away. */
export const SWATCHES: readonly { color: string; name: string }[] = [
  { color: "#f2cf4b", name: "Yellow" },
  { color: "#f4efe6", name: "Paper" },
  { color: "#dfe8d8", name: "Sage" },
  { color: "#dce9f5", name: "Sky" },
  { color: "#f6d5c8", name: "Coral" },
  { color: "#1c1b1a", name: "Ink" },
];
