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
 *
 * Tune higher if status-bar updates ever appear in profiles as
 * a top frame; tune lower if word count feels stale.
 */
const PREVIEW_DEBOUNCE_MS = 500;

export function useMarkdownPreview(markdown: string): MarkdownPreviewState {
  const [state, setState] = useState<MarkdownPreviewState>({
    document: null,
    status: "idle",
  });

  useEffect(() => {
    let cancelled = false;
    // Debounce so each keystroke during fast typing doesn't
    // post a fresh message to the worker. The preview only
    // drives the word-count in the status bar — eventual
    // consistency is fine for that consumer.
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setState((currentState) => ({
        document: currentState.document,
        status: "loading",
      }));

      markdownPreviewClient
        .renderPreview(markdown)
        .then((document) => {
          if (!cancelled) {
            setState({ document, status: "ready" });
          }
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
