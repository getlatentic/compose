/**
 * File-name rename helpers.
 *
 * The file tree and tabs show a file's full name, extension included — a
 * markdown vault may grow to hold other types (html, canvas, xml, …), so the
 * extension is meaningful and stays visible. Renaming, though, edits only the
 * base name: the directory and the extension are preserved and shown read-only,
 * so a rename can neither move the file nor change or drop its extension.
 */

/** A relative path split for renaming: the directory (with trailing slash, or
 *  ""), the editable base name, and the extension (with leading dot, or ""). */
export interface SplitName {
  dir: string;
  base: string;
  ext: string;
}

export function splitFileName(path: string): SplitName {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const fileName = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = fileName.lastIndexOf(".");
  // A dot at index 0 is a dotfile (".gitignore"), not an extension.
  if (dot <= 0) return { dir, base: fileName, ext: "" };
  return { dir, base: fileName.slice(0, dot), ext: fileName.slice(dot) };
}

/** Rebuild the relative path when renaming to `newBase`, preserving the file's
 *  directory and original extension (both read-only in the rename UI). */
export function renameRelativePath(originalPath: string, newBase: string): string {
  const { dir, ext } = splitFileName(originalPath);
  return `${dir}${newBase.trim()}${ext}`;
}

/**
 * Why `base` cannot name a file, or `null` when it can. A slash would move the
 * file into a folder, which the rename dialog does not offer; Finder shows a
 * colon as a slash; a leading dot hides the note, since the workspace scan
 * skips dot-names.
 */
export function baseNameProblem(base: string): string | null {
  const name = base.trim();
  if (name === "") return "Enter a name.";
  if (/[/\\:]/.test(name)) return "A name cannot contain / \\ or :.";
  if (name.startsWith(".")) return "A name cannot start with a dot: the note would be hidden.";
  return null;
}
