import { buildImageMarkdown, insertImageBlob } from "@latentic/live-markdown";
import { htmlToMarkdown, isComposeClipboardHtml } from "@latentic/live-markdown/codemirror/clipboard/htmlToMarkdown";

import type { ClipboardEntry } from "../captureApi";
import { linkAddress } from "../notes/insertLink";

/** Keeps an image's bytes where a note can link to them, at `images/…`. */
export type SaveImage = (relativePath: string, bytes: Uint8Array) => Promise<void>;

/**
 * An entry as Markdown for a note: formatted text converted as a paste would
 * be, a link as a link, files as links to them, and an image saved with the
 * note and linked.
 */
export async function entryMarkdown(entry: ClipboardEntry, saveImage: SaveImage): Promise<string> {
  switch (entry.kind) {
    case "image":
      return entry.imageDataUrl ? imageMarkdown(entry.imageDataUrl, saveImage) : "";
    case "link":
      return `<${entry.text.trim()}>`;
    case "files":
      return entry.text
        .split("\n")
        .filter(Boolean)
        .map((path) => `- [${fileName(path)}](${fileUrl(path)})`)
        .join("\n");
    case "text":
      return richText(entry);
  }
}

/** The formatted version as Markdown when it has one; Compose's own copies are Markdown already. */
function richText(entry: ClipboardEntry): string {
  if (entry.html && !isComposeClipboardHtml(entry.html)) {
    const markdown = htmlToMarkdown(entry.html);
    if (markdown.trim()) return markdown;
  }
  return entry.text;
}

async function imageMarkdown(dataUrl: string, saveImage: SaveImage): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return buildImageMarkdown(await insertImageBlob({ blob, saveBytes: saveImage, alt: "copied-image" }));
}

function fileName(path: string): string {
  return (path.slice(path.lastIndexOf("/") + 1) || path).replace(/[[\]]/g, "\\$&");
}

function fileUrl(path: string): string {
  return linkAddress(`file://${encodeURI(path)}`);
}
