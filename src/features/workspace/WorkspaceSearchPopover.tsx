import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useWorkspaceStore } from "../../app/workspaceStore";
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
  const open = useWorkspaceStore((state) => state.searchOpen);
  const close = useWorkspaceStore((state) => state.closeSearch);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchHit[]>([]);
  const [status, setStatus] = useState<"idle" | "searching">("idle");
  const [error, setError] = useState<string | null>(null);

  // Focus the input as the popover opens; clear stale state when it closes.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      return;
    }
    setQuery("");
    setResults([]);
    setError(null);
    setStatus("idle");
  }, [open]);

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
    if (!activeWorkspace || activeWorkspace.indexState !== "ready" || !trimmed) {
      setError(null);
      setResults([]);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setStatus("searching");
      searchWorkspaceIndex(activeWorkspace.id, trimmed, 12)
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
    activeWorkspace?.id,
    activeWorkspace?.indexState,
    activeWorkspace?.indexSnapshot?.indexedAtMs,
    query,
  ]);

  if (!open) {
    return null;
  }

  const trimmed = query.trim();

  return (
    <div
      className="bob-search-popover-backdrop"
      role="presentation"
      onClick={() => close()}
    >
      <div
        className="bob-search-popover"
        role="dialog"
        aria-label="Search workspace"
        onClick={(event) => event.stopPropagation()}
      >
        <label className="bob-search-popover__field">
          <Search size={16} aria-hidden />
          <input
            ref={inputRef}
            type="text"
            placeholder={
              activeWorkspace ? "Search files in this workspace…" : "Open a folder to search"
            }
            value={query}
            disabled={!activeWorkspace || activeWorkspace.indexState !== "ready"}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search workspace"
          />
        </label>
        <div className="bob-search-popover__results">
          {error ? (
            <p className="bob-search-popover__message">{error}</p>
          ) : status === "searching" ? (
            <p className="bob-search-popover__message">Searching…</p>
          ) : !trimmed ? (
            <p className="bob-search-popover__message">Start typing to search this workspace.</p>
          ) : results.length === 0 ? (
            <p className="bob-search-popover__message">No matches</p>
          ) : (
            results.map((result) => (
              <button
                type="button"
                key={`${result.docId}:${result.ranges[0]?.start ?? 0}`}
                className="bob-search-popover__result"
                onClick={() => {
                  void selectFile(result.path);
                  close();
                }}
              >
                <span className="bob-search-popover__result-title">{result.title}</span>
                <span className="bob-search-popover__result-path">{result.path}</span>
                <span className="bob-search-popover__result-snippet">{result.snippet}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
