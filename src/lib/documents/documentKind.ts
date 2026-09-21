/**
 * What a file Compose opens is, judged by its extension: a Markdown note, which
 * it renders, or plain text, which it shows exactly as written.
 *
 * The same lists live in Rust (`document_kind.rs`, and the index crate's
 * `markdown_path.rs`); tests hold both to the `fileAssociations` macOS is told.
 */

/** `.md` first: it is what a new note is saved as. */
export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd"] as const;
export const PLAIN_TEXT_EXTENSIONS = ["txt"] as const;

export type DocumentKind = "markdown" | "plainText";

/** A leading dot names a hidden file, not an extension. */
function extensionOf(path: string): string | null {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
}

export function documentKind(path: string): DocumentKind | null {
  const extension = extensionOf(path);
  if (extension === null) return null;
  if ((MARKDOWN_EXTENSIONS as readonly string[]).includes(extension)) return "markdown";
  if ((PLAIN_TEXT_EXTENSIONS as readonly string[]).includes(extension)) return "plainText";
  return null;
}

export function isMarkdownPath(path: string): boolean {
  return documentKind(path) === "markdown";
}

export function isPlainTextPath(path: string): boolean {
  return documentKind(path) === "plainText";
}

/** The path without a Markdown or plain-text extension; any other path unchanged. */
export function withoutDocumentExtension(path: string): string {
  const extension = extensionOf(path);
  return extension !== null && documentKind(path) !== null
    ? path.slice(0, -(extension.length + 1))
    : path;
}
