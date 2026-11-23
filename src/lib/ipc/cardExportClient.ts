import { invoke } from "@tauri-apps/api/core";

import type { DocumentRef } from "../../app/workspace/documents";
import type { CardColors } from "../export/cardColors";
import type { CardContent } from "../export/cardContent";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import type { ExportTypefaces } from "../theme/exportTypefaces";

/**
 * Image-card IPC leaf (see `compose::export::card`). The preview and the
 * export draw the same HTML, which the Rust side builds.
 */

export type CardLayout = "cover" | "quote" | "page";
export type CardSize = "landscape" | "portrait" | "square" | "story" | "wide";
export type ImageFormat = "jpeg" | "png";

export interface CardSpec {
  layout: CardLayout;
  size: CardSize;
  content: CardContent;
  colors: CardColors;
  image?: { file: string; dim: number };
  typefaces?: ExportTypefaces;
  /** The small "Compose" mark in the corner. */
  showMark: boolean;
  /** The note the card comes from, so a page card's images are found. */
  document?: DocumentRef;
}

/** Where the Share button is, in CSS pixels: the share sheet opens against it. */
export interface ShareAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pixels per size, mirrored from `CardSize::pixels` for the preview's frame. */
export const CARD_PIXELS: Record<CardSize, readonly [number, number]> = {
  landscape: [1600, 900],
  portrait: [1080, 1350],
  square: [1080, 1080],
  story: [1080, 1920],
  wide: [1200, 627],
};

export async function cardPreviewHtml(spec: CardSpec): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return invoke<string>("card_preview_html", { spec });
}

export async function exportCardImage(spec: CardSpec, format: ImageFormat, destinationPath: string): Promise<{ path: string }> {
  if (!isTauriRuntime()) {
    throw new Error("Image export is available in the desktop app.");
  }
  return invoke<{ path: string }>("document_export_image", { spec, format, destinationPath });
}

export async function copyCardImage(spec: CardSpec): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Copying an image is available in the desktop app.");
  }
  await invoke("card_copy_image", { spec });
}

/** Draws the card as PNG and opens the Mac's share sheet against `anchor`. */
export async function shareCardImage(spec: CardSpec, fileName: string, anchor: ShareAnchor): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Sharing is available in the desktop app.");
  }
  await invoke("card_share", { spec, fileName, anchor });
}
