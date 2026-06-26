/**
 * A filesystem path formatted for display: the user's home directory collapsed
 * to `~`. Display-only — never feed the result back to the filesystem. Handles
 * the macOS/Linux home prefixes (`/Users/<name>`, `/home/<name>`); any other
 * absolute path is returned unchanged.
 */
export function tildePath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, "~");
}
