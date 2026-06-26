import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { useUiStore } from "../../app/store/uiStore";
import { useWorkspaceIndex } from "../../app/store/indexStore";
import {
  searchWorkspaceIndex,
  type WorkspaceSearchHit,
} from "../../lib/ipc/indexClient";

/**
 * The workspace search modal — was the sidebar Files-tab INDEX section, now a
 * centered popover triggered by the footer Search icon. Same Rust core
 * (`workspace_search_index` → `workspace_index::search_snapshot`), same hit
 * shape; only the chrome moved. Closes on Esc, click-outside, or selecting a
 * result.
 */
export function WorkspaceSearchPopover() {
  const open = useUiStore((state) => state.searchOpen);
  const close = useUiStore((state) => state.closeSearch);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const rebuildIndex = useWorkspaceStore((state) => state.rebuildWorkspaceIndex);
  const index = useWorkspaceIndex(activeWorkspaceId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggeredRef = useRef(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchHit[]>([]);
  const [status, setStatus] = useState<"idle" | "searching">("idle");
  const [error, setError] = useState<string | null>(null);

  // Focus the input as the popover opens; clear stale state when it closes.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      // Opening search is a natural retry point: kick a rebuild (once per open)
      // when the index never built or previously failed, so a stuck index
      // recovers on its own rather than leaving a dead search box.
      if (
        !triggeredRef.current &&
        activeWorkspaceId &&
        (index.state === "idle" || index.state === "failed")
      ) {
        triggeredRef.current = true;
        void rebuildIndex(activeWorkspaceId);
      }
      return;
    }
    triggeredRef.current = false;
    setQuery("");
    setResults([]);
    setError(null);
    setStatus("idle");
  }, [open, activeWorkspaceId, index.state, rebuildIndex]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!activeWorkspaceId || index.state !== "ready" || !trimmed) {
      setError(null);
      setResults([]);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setStatus("searching");
      searchWorkspaceIndex(activeWorkspaceId, trimmed, 12)
        .then((hits) => {
          if (!cancelled) {
            setError(null);
            setResults(hits);
            setStatus("idle");
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Search failed");
            setResults([]);
            setStatus("idle");
          }
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeWorkspaceId,
    index.state,
    index.snapshot?.indexedAtMs,
    query,
  ]);

  if (!open) {
    return null;
  }

  const trimmed = query.trim();

  return (
    <div
      className="search-popover-backdrop"
      role="presentation"
      onClick={() => close()}
    >
      <div
        className="search-popover"
        role="dialog"
        aria-label="Search workspace"
        onClick={(event) => event.stopPropagation()}
      >
        <label className="search-popover__field">
          <Search size={16} aria-hidden />
          <input
            ref={inputRef}
            type="text"
            placeholder={
              activeWorkspaceId ? "Search files in this workspace…" : "Open a folder to search"
            }
            value={query}
            disabled={!activeWorkspaceId || index.state !== "ready"}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search workspace"
          />
        </label>
        <div className="search-popover__results">
          {index.state === "failed" ? (
            <div className="search-popover__message">
              <p>Couldn't build the search index.</p>
              {index.error ? <p className="search-popover__detail">{index.error}</p> : null}
              <button
                type="button"
                className="search-popover__retry"
                onClick={() => {
                  if (activeWorkspaceId) {
                    void rebuildIndex(activeWorkspaceId);
                  }
                }}
              >
                Try again
              </button>
            </div>
          ) : activeWorkspaceId && index.state !== "ready" ? (
            <p className="search-popover__message">Indexing your notes…</p>
          ) : error ? (
            <p className="search-popover__message">{error}</p>
          ) : status === "searching" ? (
            <p className="search-popover__message">Searching…</p>
          ) : !trimmed ? (
            <p className="search-popover__message">Start typing to search this workspace.</p>
          ) : results.length === 0 ? (
            <p className="search-popover__message">No matches</p>
          ) : (
            results.map((result) => (
              <button
                type="button"
                key={`${result.docId}:${result.ranges[0]?.start ?? 0}`}
                className="search-popover__result"
                onClick={() => {
                  void selectFile(result.path);
                  close();
                }}
              >
                <span className="search-popover__result-title">{result.title}</span>
                <span className="search-popover__result-path">{result.path}</span>
                <span className="search-popover__result-snippet">{result.snippet}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
