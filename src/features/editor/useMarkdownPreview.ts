import { useEffect, useState } from "react";
import { markdownPreviewClient } from "../../lib/workers/markdownPreviewClient";
import type { MarkdownPreviewDocument } from "../../workers/shared/markdownTypes";

type MarkdownPreviewState =
  | { status: "idle"; document: null }
  | { status: "loading"; document: MarkdownPreviewDocument | null }
  | { status: "ready"; document: MarkdownPreviewDocument }
  | { status: "failed"; document: null; errorMessage: string };

/**
 * How long after the last keystroke we wait before kicking the
 * worker. The preview drives the status-bar word count — users
 * don't notice a half-second lag on the count, but they DO feel
 * the keystroke-by-keystroke worker fan-out without this debounce.
 */
const PREVIEW_DEBOUNCE_MS = 500;

/**
 * Module-level LRU cache of rendered preview docs keyed by content hash.
 * The dominant tab-switch cost on `compose-test-50` was the worker
 * re-parsing the same 1 MB markdown every time you switched back to a
 * file — confirmed via Safari Web Inspector Timeline (see
 * docs/perf-spec.md §5). With this cache, switching to a file whose
 * content is unchanged short-circuits the worker entirely; only an
 * edit invalidates a cached entry.
 *
 * 16 entries × max ~1 MB doc reference each is bounded (the
 * `MarkdownPreviewDocument` is the parsed AST, not the raw string).
 * Eviction is least-recently-used — re-inserting on hit moves the
 * key to the tail.
 */
const PREVIEW_CACHE_MAX = 16;
const previewCache = new Map<string, MarkdownPreviewDocument>();

function hashMarkdown(markdown: string): string {
  // FNV-1a, same tiny hash used by the editor for save-loop dedup.
  // Collisions don't poison the cache because the consumer is the
  // word-count status bar — a wrong count is a 500ms blip, not a
  // correctness bug.
  let h = 0x811c9dc5;
  for (let i = 0; i < markdown.length; i += 1) {
    h ^= markdown.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16) + ":" + markdown.length;
}

function cacheGet(key: string): MarkdownPreviewDocument | undefined {
  const cached = previewCache.get(key);
  if (cached) {
    // Re-insert to move to tail (LRU touch).
    previewCache.delete(key);
    previewCache.set(key, cached);
  }
  return cached;
}

function cacheSet(key: string, doc: MarkdownPreviewDocument): void {
  if (previewCache.has(key)) {
    previewCache.delete(key);
  } else if (previewCache.size >= PREVIEW_CACHE_MAX) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
  previewCache.set(key, doc);
}

export function useMarkdownPreview(markdown: string): MarkdownPreviewState {
  const [state, setState] = useState<MarkdownPreviewState>({
    document: null,
    status: "idle",
  });

  useEffect(() => {
    let cancelled = false;

    // Cache hit short-circuit — no debounce, no worker, no state churn
    // beyond the setState. This is the tab-switch-back path.
    const key = hashMarkdown(markdown);
    const cached = cacheGet(key);
    if (cached) {
      // Reuse the previous state object when nothing actually changed (same
      // cached doc, already "ready") so the returned reference is stable —
      // otherwise this effect re-runs on every keystroke that lands on a cached
      // hash and hands consumers a structurally-identical-but-new object,
      // forcing a wasted re-render (react-scan: "reference changed but
      // structurally the same").
      setState((prev) =>
        prev.status === "ready" && prev.document === cached
          ? prev
          : { document: cached, status: "ready" },
      );
      return () => {
        cancelled = true;
      };
    }

    // Cache miss — debounce so each keystroke during fast typing
    // doesn't post a fresh message to the worker.
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setState((currentState) =>
        currentState.status === "loading"
          ? currentState
          : { document: currentState.document, status: "loading" },
      );

      markdownPreviewClient
        .renderPreview(markdown)
        .then((document) => {
          if (cancelled) return;
          cacheSet(key, document);
          setState({ document, status: "ready" });
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setState({
              document: null,
              errorMessage: error instanceof Error ? error.message : "Preview render failed",
              status: "failed",
            });
          }
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [markdown]);

  return state;
}
