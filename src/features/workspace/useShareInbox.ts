import { useEffect } from "react";

import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { showErrorToast } from "../toast/toastStore";
import { pageMarkdown, selectionMarkdown } from "./webClip";

const SHARE_INBOX_EVENT = "compose:share-inbox-changed";
const PENDING_CMD = "share_inbox_pending";
const IMPORT_CMD = "share_inbox_import";

/** A clip Share → Compose left for the app, with the parts only the frontend
 *  can turn into Markdown. */
export interface PendingClip {
  id: string;
  url: string | null;
  html: string | null;
  text: string | null;
  /** A whole web page shared from Safari, whose article becomes the note. */
  page: string | null;
  /** Markdown the browser clipper already made from the page. */
  markdown: string | null;
}

type Invoke = typeof import("@tauri-apps/api/core").invoke;

/** How each kind of shared content becomes Markdown. */
export interface ClipConverters {
  /** A whole web page, by its article; `null` when it has none. */
  page: (page: string, url: string | null) => Promise<string | null>;
  /** A selection from the web page at `url`, kept whole. */
  selection: (html: string, url: string) => Promise<string>;
  /** Rich text from an app, which has no page behind it. */
  richText: (html: string) => Promise<string>;
}

async function pasteConversion(html: string): Promise<string> {
  // Loaded only when a clip carries rich text, so turndown stays out of the
  // bundle that has to load before the app can draw.
  const { htmlToMarkdown } = await import(
    "@latentic/live-markdown/codemirror/clipboard/htmlToMarkdown"
  );
  return htmlToMarkdown(html);
}

const CONVERTERS: ClipConverters = {
  page: pageMarkdown,
  selection: selectionMarkdown,
  richText: pasteConversion,
};

/**
 * The Markdown a clip's shared content becomes. Web content goes through
 * Defuddle: a selection whole, a page by its article. Rich text from an app,
 * which carries no address, goes through the converter a paste uses, which
 * knows the markup those apps write.
 */
export async function clipBody(clip: PendingClip, convert: ClipConverters = CONVERTERS): Promise<string> {
  if (clip.markdown) return clip.markdown;
  if (clip.html) {
    return clip.url ? convert.selection(clip.html, clip.url) : convert.richText(clip.html);
  }
  if (clip.page) {
    const article = await convert.page(clip.page, clip.url);
    if (article) return article;
  }
  return clip.text ?? "";
}

async function fileClip(invoke: Invoke, clip: PendingClip): Promise<void> {
  try {
    await invoke(IMPORT_CMD, { clipId: clip.id, markdown: await clipBody(clip) });
  } catch (error) {
    showErrorToast(`Could not file a shared clip: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * File the clips Share → Compose leaves in the app-group inbox. Rust owns
 * everything that touches disk; this converts, then hands each clip back.
 *
 * Mounted by MainApp, so the first drain sees a hydrated workspace list; clips
 * shared while the app was closed wait in the inbox until then.
 */
export function useShareInbox(): void {
  useEffect(function bindShareInbox() {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    let draining = false;
    let requested = false;

    async function drain() {
      // A burst of watcher events must not file one clip twice: a drain already
      // in flight goes round once more when it finishes.
      if (draining) {
        requested = true;
        return;
      }
      draining = true;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        do {
          requested = false;
          const pending = await invoke<PendingClip[]>(PENDING_CMD);
          for (const clip of pending) {
            if (disposed) return;
            await fileClip(invoke, clip);
          }
        } while (requested && !disposed);
      } catch (error) {
        console.error("Failed to read shared clips:", error);
      } finally {
        draining = false;
      }
    }

    void (async () => {
      const eventApi = await import("@tauri-apps/api/event");
      if (disposed) return;
      // Listen before the first drain, so a clip that lands mid-drain is not
      // left waiting for the next launch.
      unlisten = await eventApi.listen(SHARE_INBOX_EVENT, () => {
        void drain();
      });
      if (disposed) {
        unlisten();
        return;
      }
      await drain();
    })();

    return function unbind() {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);
}
