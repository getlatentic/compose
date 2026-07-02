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
 * Split a comment message back into its file path and its markdown body (the
 * blockquote + note), for the excerpt card to render. Returns null for any
 * message that isn't a commented excerpt (a plain chat turn).
 */
export function parseExcerptPreamble(content: string): { path: string; body: string } | null {
  const match = content.match(PREAMBLE);
  if (!match) {
    return null;
  }
  return { path: match[1], body: match[2] };
}
