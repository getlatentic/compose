import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";

/**
 * Display-time resolution of image `src` values for the editor.
 *
 * Markdown stores image references **workspace-relative and portable** (e.g.
 * `images/pasted-….png`), which is what lands on disk and survives moving the
 * folder between machines. A WKWebView, though, can't load a relative path —
 * the page origin is `tauri://localhost`, so `images/foo.png` 404s and shows a
 * broken-image placeholder.
 *
 * On the desktop the fix is Tauri's `asset:` protocol: resolve the reference
 * against the markdown file's directory to an absolute path, then
 * `convertFileSrc` it into an `asset://…` URL the webview streams straight off
 * disk. The Rust side scopes the protocol to the open workspace
 * (`asset_protocol_scope().allow_directory`). The stored attribute is never
 * touched — only the rendered `<img src>` — so serialization stays relative.
 *
 * In the browser there is no local filesystem; pasted images are already
 * inlined as `data:` URLs (which pass straight through), and any other relative
 * reference simply renders as-is.
 *
 * Paths are treated as POSIX (`/`), matching the macOS/Linux workspace folders
 * this targets. Windows-style drive paths are passed through unresolved.
 */
export interface ImageResolveContext {
  /** Absolute OS directory of the markdown file being edited, or null. */
  fileDir: string | null;
}

// Anything that already carries a scheme (`data:`, `http(s):`, `asset:`,
// `blob:`, `file:`, `tauri:`, `mailto:` …), a protocol-relative `//`, or a bare
// fragment `#` is left untouched.
const HAS_SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

export function resolveDisplaySrc(rawSrc: string, ctx: ImageResolveContext): string {
  const src = rawSrc.trim();
  if (!src || HAS_SCHEME.test(src)) {
    return src;
  }
  // Only the desktop can stream local files. In the browser, relative refs have
  // no backing file (binary isn't stored in the virtual workspace), so render
  // them as-is rather than fabricate an unreachable URL.
  if (!isTauriRuntime() || !ctx.fileDir) {
    return src;
  }
  const absolute = isAbsolutePath(src) ? src : joinPath(ctx.fileDir, src);
  return convertFileSrc(absolute);
}

/**
 * The directory a relative image reference resolves against: the folder
 * containing the active markdown file. Falls back to the workspace root when
 * the file path is unknown, and to null when there's no workspace.
 */
export function computeFileDir(
  workspaceRoot: string | null | undefined,
  filePath: string | null | undefined,
): string | null {
  if (!workspaceRoot) return null;
  if (!filePath) return workspaceRoot;
  return dirnamePath(joinPath(workspaceRoot, filePath));
}

export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/");
}

/** POSIX `dirname`: the parent of a path, with trailing slashes ignored. */
export function dirnamePath(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) return ".";
  if (idx === 0) return "/";
  return trimmed.slice(0, idx);
}

/**
 * Join `rel` onto `dir`, normalizing `.` and `..` segments. Absolute-ness is
 * inherited from `dir`; `..` never escapes above an absolute root.
 */
export function joinPath(dir: string, rel: string): string {
  const isAbs = isAbsolutePath(dir);
  const out: string[] = [];
  for (const part of `${dir}/${rel}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") {
        out.pop();
      } else if (!isAbs) {
        out.push("..");
      }
      continue;
    }
    out.push(part);
  }
  return (isAbs ? "/" : "") + out.join("/");
}
