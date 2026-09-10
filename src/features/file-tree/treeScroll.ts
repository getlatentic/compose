/**
 * Where the file tree was scrolled to, per workspace.
 *
 * The tree scrolls itself to the open file after the first paint, which is a
 * jump the reader sees. Last session's offset already has that file in view —
 * it is where they were — so restoring it makes the first frame right and
 * leaves the reveal with nothing to do.
 *
 * localStorage because it has to be readable synchronously, before the
 * virtualiser's first render: a round-trip would be the very thing it avoids.
 */

const KEY = "compose.treeScroll.v1";
const WRITE_DELAY_MS = 400;

function readAll(): Record<string, number> {
  if (typeof localStorage === "undefined") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function readTreeScroll(workspaceKey: string | undefined): number {
  if (!workspaceKey) {
    return 0;
  }
  const offset = readAll()[workspaceKey];
  return typeof offset === "number" && Number.isFinite(offset) && offset > 0 ? offset : 0;
}

let pending: ReturnType<typeof setTimeout> | null = null;

/** Debounced: scrolling fires continuously and this only has to survive a quit. */
export function persistTreeScroll(workspaceKey: string | undefined, offset: number): void {
  if (!workspaceKey || typeof localStorage === "undefined") {
    return;
  }
  if (pending) {
    clearTimeout(pending);
  }
  pending = setTimeout(() => {
    pending = null;
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [workspaceKey]: Math.round(offset) }));
    } catch {
      // Best-effort; a full or unavailable store just costs the restore.
    }
  }, WRITE_DELAY_MS);
}
