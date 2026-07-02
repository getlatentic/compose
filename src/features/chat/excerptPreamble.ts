/**
 * The comment-to-chat message body — built and parsed in ONE place so the chat's
 * excerpt card can reconstruct its parts (file path, quoted body) from the
 * persisted message content, which is exactly the text the model receives. Only
 * the selection's line:column lives outside this (on the excerpt struct);
 * everything else is recoverable from the content, so the card renders the same
 * before and after a reload, and for legacy messages saved without the struct.
 */

export interface ExcerptPreambleParts {
  filePath: string;
  text: string;
  note: string;
}

/**
 * Build the user message for a commented excerpt: a header naming the file, the
 * selection as a markdown blockquote, then the user's note. The inverse is
 * {@link parseExcerptPreamble}; a round-trip test keeps them in lockstep.
 */
export function formatExcerptPreamble({ filePath, text, note }: ExcerptPreambleParts): string {
  const quoted = text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `About this excerpt from \`${filePath}\`:\n\n${quoted}\n\n${note}`;
}

const PREAMBLE = /^About this excerpt from `([^`]+)`:\n\n([\s\S]*)$/;

/**
 * Split a comment message back into its file path, the quoted excerpt (a
 * markdown blockquote), and the note (the user's comment) — kept apart so the
 * card can clamp the excerpt while always showing the note. Returns null for
 * any message that isn't a commented excerpt (a plain chat turn).
 */
export function parseExcerptPreamble(
  content: string,
): { path: string; quote: string; note: string } | null {
  const match = content.match(PREAMBLE);
  if (!match) {
    return null;
  }
  const body = match[2];
  // The blockquote runs until the first blank line; the note is what follows.
  // Every quoted line is `> `-prefixed (even blank source lines), so the quote
  // never contains a blank line — the first `\n\n` is the boundary.
  const separator = body.indexOf("\n\n");
  if (separator === -1) {
    return { path: match[1], quote: body, note: "" };
  }
  return { path: match[1], quote: body.slice(0, separator), note: body.slice(separator + 2) };
}
