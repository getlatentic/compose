import { convertFileSrc } from "@tauri-apps/api/core";
import {
  hasUriScheme,
  isAbsolutePath,
  joinPath,
  type ImageResolveContext,
} from "ai-editor";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";

/**
 * Desktop image-src resolver — Compose's implementation of the editor's
 * `resolveImageSrc` seam.
 *
 * Markdown stores image references workspace-relative (`images/foo.png`). A
 * WKWebView can't load those against the `tauri://localhost` origin, so resolve
 * the reference against the file's directory to an absolute path and
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
