import type { NavEntry, WorkspaceStoreGet } from "./types";

/**
 * When true, `pushNavEntry` short-circuits — used by `navigateBack` /
 * `navigateForward` so re-applying a history entry doesn't *append* a new one
 * to the stack (which would make Forward unreachable). Module-level: there
 * is exactly one store per window's JS context, and this flag is only flipped
 * synchronously around an `applyNavEntry` call.
 */
let suppressNavPush = false;

/** Push a new nav entry, truncating any "forward" entries past the current
 * position — same behavior a browser exhibits when you navigate after going
 * back. Coalesces consecutive duplicates so repeated selects of the same file
 * don't bloat the stack. */
export function pushNavEntry(
  state: { navHistory: NavEntry[]; navIndex: number },
  entry: NavEntry,
): { navHistory: NavEntry[]; navIndex: number } | null {
  if (suppressNavPush) {
    return null;
  }
  const current = state.navHistory[state.navIndex];
  if (
    current
    && current.kind === entry.kind
    && current.id === entry.id
    && current.workspaceId === entry.workspaceId
  ) {
    return null;
  }
  const truncated = state.navHistory.slice(0, state.navIndex + 1);
  truncated.push(entry);
  return { navHistory: truncated, navIndex: truncated.length - 1 };
}

/** Drop every history entry a file's removal invalidates, keeping `navIndex`
 * pointed at the same surviving entry. Called when a file is deleted so
 * Back/Forward can't resurrect it as a dangling error tab (#45). */
export function pruneNavHistory(
  state: { navHistory: NavEntry[]; navIndex: number },
  keep: (entry: NavEntry) => boolean,
): { navHistory: NavEntry[]; navIndex: number } {
  const navHistory: NavEntry[] = [];
  let navIndex = state.navIndex;
  state.navHistory.forEach((entry, index) => {
    if (keep(entry)) {
      navHistory.push(entry);
    } else if (index <= state.navIndex) {
      // A removed entry at or before the cursor shifts the cursor left.
      navIndex -= 1;
    }
  });
  return {
    navHistory,
    navIndex: navHistory.length === 0 ? -1 : Math.max(0, Math.min(navIndex, navHistory.length - 1)),
  };
}

/** Re-apply a nav entry without pushing a new one (the flag does the work).
 * Reads through the live store so the entry can target a different workspace
 * than the current one. */
export function applyNavEntry(get: WorkspaceStoreGet, entry: NavEntry) {
  suppressNavPush = true;
  try {
    if (get().activeWorkspaceId !== entry.workspaceId) {
      get().switchWorkspace(entry.workspaceId);
    }
    if (entry.kind === "file") {
      void get().selectFile(entry.id);
    } else {
      void get().openConversation(entry.id);
    }
  } finally {
    suppressNavPush = false;
  }
}
