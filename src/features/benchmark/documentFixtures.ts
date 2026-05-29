/**
 * Deterministic benchmark documents.
 *
 * The lag baseline is only meaningful if the input is fixed: same bytes,
 * same line structure, every run. These generators build Markdown that
 * exercises the parser's real branches (headings, emphasis, inline code,
 * links, lists, block quotes) rather than a flat wall of prose, so the
 * `parseFullDoc` / plan numbers reflect production-shaped content.
 *
 * Content is intentionally ASCII-only. The byte↔code-unit conversion
 * paths for multi-byte text are covered exhaustively by
 * `positionMapper.test.ts`; here we want byte offset == code-unit index
 * so caret/selection arithmetic in the editor operations is exact and
 * the numbers aren't muddied by an orthogonal concern.
 */

import { byteLength } from "../text/positionMapper";

export type DocumentSizeLabel = "small" | "large" | "xlarge";

/** Ordered smallest→largest so the report scenarios read naturally. */
export const DOCUMENT_SIZE_LABELS: readonly DocumentSizeLabel[] = ["small", "large", "xlarge"];

/** Approximate byte target per size. Actual size is recorded post-build. */
const BYTE_TARGETS: Record<DocumentSizeLabel, number> = {
  small: 256,
  large: 300 * 1024,
  xlarge: 500 * 1024,
};

export interface BenchmarkDocument {
  label: DocumentSizeLabel;
  text: string;
  lineCount: number;
  /** UTF-8 byte length (== code-unit length here, content is ASCII). */
  byteSize: number;
}

/**
 * One self-contained Markdown section, parameterised by index so no two
 * blocks are byte-identical (prevents any accidental parser-side dedup
 * and keeps link targets distinct).
 */
function section(index: number): string {
  return [
    `## Section ${index}`,
    "",
    `This paragraph carries **bold ${index}**, *italic*, \`inline code\`, and a ` +
      `[reference link](https://example.com/topic/${index}) followed by a closing clause.`,
    "",
    `- first item discussing concern ${index}`,
    `- second item with a \`snippet_${index}()\` call`,
    "- third item, plain text",
    "",
    `> A block quote summarising section ${index} in a single line.`,
    "",
  ].join("\n");
}

/** Build the largest text not yet past `targetBytes`, always >= one section. */
function generate(targetBytes: number): string {
  const parts: string[] = [];
  let bytes = 0;
  let index = 0;
  do {
    const block = section(index);
    parts.push(block);
    bytes += byteLength(block);
    index += 1;
  } while (bytes < targetBytes);
  return parts.join("");
}

/** Build the fixed benchmark document for a size label. */
export function buildDocument(label: DocumentSizeLabel): BenchmarkDocument {
  const text = generate(BYTE_TARGETS[label]);
  return {
    label,
    text,
    lineCount: countLines(text),
    byteSize: byteLength(text),
  };
}

/** Number of lines == number of `\n` plus one (no trailing-newline quirk). */
function countLines(text: string): number {
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 0x0a) lines += 1;
  }
  return lines;
}

/**
 * Byte ranges of the `count` lines starting at `firstLine`, computed
 * once so the comment-overlay paint loop can iterate visible-line ranges
 * without re-scanning the document inside the timed region. Ranges are
 * half-open `[start, end)` UTF-8 byte offsets, end-exclusive of the
 * newline. Clamps to the document's available lines.
 */
export function lineByteRanges(
  text: string,
  firstLine: number,
  count: number,
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let line = 0;
  let lineStart = 0;
  for (let byte = 0; byte <= text.length && ranges.length < count; byte += 1) {
    const atEnd = byte === text.length;
    if (atEnd || text.charCodeAt(byte) === 0x0a) {
      if (line >= firstLine) ranges.push({ start: lineStart, end: byte });
      line += 1;
      lineStart = byte + 1;
      if (atEnd) break;
    }
  }
  return ranges;
}
