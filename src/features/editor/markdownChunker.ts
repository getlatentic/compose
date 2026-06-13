/**
 * Markdown chunker for async Tiptap setContent.
 *
 * Tiptap's `setContent` on a 1MB markdown takes ~7s on the main thread (the
 * dominant cost in a tab-switch open of a big doc — see
 * `docs/editor-guide.md` § v1.1 perf target). To keep the UI responsive while
 * a big doc loads, the editor calls this chunker to split the markdown at
 * paragraph boundaries, calls `setContent` on the first chunk synchronously
 * (~100ms freeze, user sees text in the next frame), then queues each
 * subsequent chunk via `requestAnimationFrame` so the browser paints and
 * processes input between insertions.
 *
 * The contract this module owes its caller:
 *
 *   * **Each chunk parses as valid standalone markdown.** That means we
 *     never split inside a fenced code block (`` ``` ``), an HTML block, or
 *     mid-line. The chunker walks line-by-line and only considers a flush
 *     point at a blank line outside any open fence.
 *
 *   * **Concatenating all chunks reproduces the input byte-for-byte** —
 *     `chunks.join("")` === `input`. The chunker preserves trailing
 *     newlines on each chunk; nothing is added or dropped. This is what
 *     makes the round trip safe: the editor can serialize the assembled
 *     doc back to markdown and get back the user's file.
 *
 *   * **Chunks are at least `targetBytes` and stop at the next paragraph
 *     break.** If a single paragraph or code block exceeds the target, the
 *     chunk grows to fit it — we never break atomic markdown structures
 *     just to hit a size target. Pathological case (no blank lines in the
 *     whole document, single huge paragraph): the result is one chunk.
 *
 *   * **No allocations per character.** Per `docs/editor-guide.md` ("one
 *     perf principle"): the hot loop is line-aware but allocates only one
 *     string per line and one per chunk, not per character. The chunker
 *     itself must not become the new bottleneck.
 *
 * The `shouldChunk` predicate is the editor's gate — small docs take the
 * existing one-shot fast path; only docs above the threshold pay the chunk-
 * insert overhead (which is real: each `insertContentAt` triggers a
 * ProseMirror transaction).
 */

/**
 * Threshold above which the editor takes the chunked path. Below this, the
 * existing single `setContent` is faster end-to-end because the per-chunk
 * transaction overhead exceeds the saving. Tuned against
 * `tiptapSetContent.baseline.spec.ts`: at 300KB the single setContent is
 * ~2.8s — chunkable, but the freeze is short enough that a user reads it as
 * "a beat of loading," not "stuck." Above 100KB we want first-paint feedback
 * so the UI never *feels* stuck.
 */
export const CHUNK_THRESHOLD_BYTES = 100 * 1024;

/**
 * Target chunk size. ~50KB is a sweet spot:
 *   * The first chunk's setContent lands in ~100ms — under one frame budget
 *     plus a bit, fast enough to feel instant.
 *   * Subsequent inserts cost ~300ms each — yields cleanly between rAFs.
 *   * Total chunks on a 1MB doc ≈ 20 — distributes the freeze across ~6s
 *     of wall-clock while letting input through.
 */
export const DEFAULT_CHUNK_BYTES = 50 * 1024;

/**
 * Decide whether a body is big enough to pay the chunked-insert overhead.
 * Caller pattern:
 *
 *   if (shouldChunk(body)) loadDocChunked(editor, body);
 *   else editor.commands.setContent(markdownToHtmlFast(body), ...);
 */
export function shouldChunk(markdown: string, threshold: number = CHUNK_THRESHOLD_BYTES): boolean {
  return markdown.length >= threshold;
}

/**
 * Split markdown at paragraph boundaries (blank lines) outside any open
 * fenced code block. Each returned chunk is complete, standalone markdown
 * and includes its trailing newlines so concatenation reproduces the input.
 *
 * Returns a single-chunk array if the input is below `targetBytes` or
 * contains no flushable paragraph boundaries.
 */
export function chunkMarkdownAtParagraphs(
  markdown: string,
  targetBytes: number = DEFAULT_CHUNK_BYTES,
): string[] {
  if (markdown.length === 0) return [];
  if (markdown.length <= targetBytes) return [markdown];

  const chunks: string[] = [];
  let chunkStart = 0;
  let inFence = false;
  let i = 0;

  while (i < markdown.length) {
    // Find the end of the current line.
    const newline = markdown.indexOf("\n", i);
    const lineEnd = newline === -1 ? markdown.length : newline + 1;
    const lineLen = lineEnd - i;

    // Update fence state. A line that starts with ``` (after optional
    // indentation, but we accept only column-0 fences for simplicity —
    // CommonMark allows up to 3 leading spaces; if this becomes an issue
    // we can extend) toggles the fence.
    if (isCodeFenceLine(markdown, i, lineEnd)) {
      inFence = !inFence;
    }

    // Consider a flush only if:
    //   * we're past the target size for this chunk, AND
    //   * we're outside any fence, AND
    //   * the current line is blank (trimmed empty) — the paragraph break.
    const chunkSoFar = lineEnd - chunkStart;
    if (chunkSoFar >= targetBytes && !inFence && isBlankLine(markdown, i, lineEnd)) {
      chunks.push(markdown.slice(chunkStart, lineEnd));
      chunkStart = lineEnd;
    }

    i = lineEnd;
    // Defensive: if `indexOf` reports the end and lineLen is 0, break to
    // avoid an infinite loop. Shouldn't happen given the indexOf logic.
    if (lineLen === 0) break;
  }

  // Flush remainder.
  if (chunkStart < markdown.length) {
    chunks.push(markdown.slice(chunkStart));
  }

  return chunks;
}

/**
 * A code fence line is one whose first non-space character starts a run of
 * 3+ backticks (or 3+ tildes). We accept up to 3 leading spaces per
 * CommonMark; deeper indentation is a code block, not a fence.
 */
function isCodeFenceLine(text: string, start: number, end: number): boolean {
  let i = start;
  let leading = 0;
  while (i < end && leading < 4 && text.charCodeAt(i) === 0x20 /* space */) {
    i += 1;
    leading += 1;
  }
  if (leading > 3) return false;
  const ch = text.charCodeAt(i);
  if (ch !== 0x60 /* ` */ && ch !== 0x7e /* ~ */) return false;
  let run = 0;
  while (i < end && text.charCodeAt(i) === ch) {
    i += 1;
    run += 1;
  }
  return run >= 3;
}

/**
 * A blank line contains only whitespace (spaces, tabs) up to its newline.
 * The line may include the trailing `\n` (the loop hands us a half-open
 * range including the newline).
 */
function isBlankLine(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) {
    const ch = text.charCodeAt(i);
    if (ch === 0x0a /* \n */) continue;
    if (ch !== 0x20 /* space */ && ch !== 0x09 /* tab */) return false;
  }
  return true;
}
