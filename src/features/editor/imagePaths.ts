import { convertFileSrc } from "@tauri-apps/api/core";
import {
  hasUriScheme,
  isAbsolutePath,
  joinPath,
  type ImageResolveContext,
} from "@latentic/live-markdown";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";

/**
 * Where a document's images live — both directions of one convention, kept
 * together because they drifted apart when they were not: images were written
 * at the workspace root while the editor resolved them against the document's
 * own directory, so a note in a subfolder referenced an image that was never at
 * the path it named.
 */

/** Directory part of a workspace-relative path; `""` for a file at the root. */
function parentDir(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index < 0 ? "" : filePath.slice(0, index);
}

/**
 * Workspace-relative destination for an image the editor will reference as
 * `relPath` from `docPath`. Markdown resolves a relative reference against the
 * file carrying it — as every other renderer of these notes does, Obsidian
 * included — so the bytes land beside the document, not at the workspace root.
 */
export function imageWritePath(docPath: string, relPath: string): string {
  const dir = parentDir(docPath);
  return dir ? `${dir}/${relPath}` : relPath;
}

/**
 * Desktop image-src resolver — Compose's implementation of the editor's
 * `resolveImageSrc` seam.
 *
 * Markdown stores image references relative to the document (`images/foo.png`).
 * A WKWebView can't load those against the `tauri://localhost` origin, so
 * resolve the reference against the file's directory to an absolute path and
 * `convertFileSrc` it into an `asset://…` URL the webview streams off disk. The
 * Rust side scopes the protocol to the open workspace. The stored attribute is
 * never touched — only the rendered `<img src>` — so serialization stays
 * relative. In the browser preview there's no asset protocol, so relative refs
 * (which have no backing file) render as-is.
 */
export function resolveDisplaySrc(rawSrc: string, ctx: ImageResolveContext): string {
  const src = rawSrc.trim();
  if (!src || hasUriScheme(src)) {
    return src;
  }
  if (!isTauriRuntime() || !ctx.fileDir) {
    return src;
  }
  const absolute = isAbsolutePath(src) ? src : joinPath(ctx.fileDir, src);
  return convertFileSrc(absolute);
}
