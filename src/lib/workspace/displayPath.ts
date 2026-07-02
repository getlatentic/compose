/**
 * A filesystem path formatted for display: the user's home directory collapsed
 * to `~`. Display-only — never feed the result back to the filesystem. Handles
 * the macOS/Linux home prefixes (`/Users/<name>`, `/home/<name>`); any other
 * absolute path is returned unchanged.
 */
export function tildePath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, "~");
}

/**
 * The last segment of a path — the file (or folder) name — for a chip or label
 * where the full path is noise. Display-only; keep the full path on hover
 * (`title`) so it stays reachable. A bare name with no separator returns
 * unchanged. Trailing slashes are ignored so a folder path yields its own name.
 */
export function basename(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}
