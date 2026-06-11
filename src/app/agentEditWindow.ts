/**
 * Tracks, per workspace, whether a file change on disk is attributable to a
 * just-run agent rather than a genuine external edit.
 *
 * Why this exists: in `snapshot` mode a write-capable harness edits the user's
 * real files *directly* while it runs (see review-guide). The file watcher then
 * fires a `modified` event for each edited file. If the user happened to have
 * that file open with unsaved edits, the generic conflict path would raise the
 * "changed on disk — reload / keep my changes" banner — but the agent's edit is
 * intended and already reviewed (in-chat applied diff) and undoable (version
 * history), so a conflict prompt is wrong here. We instead auto-reload.
 *
 * The distinction is clean: a `snapshot`-mode run is the only in-app source of
 * programmatic real-file writes, so any disk change *while such a run's window
 * is open* is agent-driven; a change with no open window is external and keeps
 * the conflict banner. The window stays open for a short grace period after the
 * run finishes to absorb the watcher's debounced trailing events (the `exited`
 * event and the final FS notifications don't arrive in a guaranteed order).
 *
 * `clone` mode needs no entry here: that run edits a sandbox *outside* the
 * watched root, so the watcher never fires on the real files at all.
 */

/** How long the window stays "active" after a run finishes, to catch the
 * watcher's debounced trailing `modified` events for the agent's last writes. */
const GRACE_MS = 1500;

interface WindowState {
  /** Number of in-flight agent-edit runs for this workspace (usually 0 or 1). */
  active: number;
  /** Timer id for the post-run grace window, or null when none is pending. */
  graceTimer: ReturnType<typeof setTimeout> | null;
  /** Wall-clock deadline (ms) until which a finished run still counts as active. */
  graceUntil: number;
}

const windows = new Map<string, WindowState>();

function stateFor(workspaceId: string): WindowState {
  let state = windows.get(workspaceId);
  if (!state) {
    state = { active: 0, graceTimer: null, graceUntil: 0 };
    windows.set(workspaceId, state);
  }
  return state;
}

/** Mark the start of an agent-edit run (snapshot mode) for a workspace. Any
 * pending grace window is cleared — a fresh run supersedes the tail of the
 * previous one. */
export function beginAgentEditWindow(workspaceId: string): void {
  const state = stateFor(workspaceId);
  state.active += 1;
  if (state.graceTimer != null) {
    clearTimeout(state.graceTimer);
    state.graceTimer = null;
  }
  state.graceUntil = 0;
}

/** Mark an agent-edit run finished. The window stays "active" for a short grace
 * period so trailing watcher events for the agent's writes are still attributed
 * to it rather than treated as an external edit. */
export function endAgentEditWindow(workspaceId: string): void {
  const state = windows.get(workspaceId);
  if (!state || state.active === 0) {
    return;
  }
  state.active -= 1;
  if (state.active > 0) {
    return;
  }
  state.graceUntil = Date.now() + GRACE_MS;
  if (state.graceTimer != null) {
    clearTimeout(state.graceTimer);
  }
  state.graceTimer = setTimeout(() => {
    const current = windows.get(workspaceId);
    if (current) {
      current.graceTimer = null;
      current.graceUntil = 0;
    }
  }, GRACE_MS);
}

/** Whether a disk change for this workspace right now should be treated as
 * agent-driven (a run is in flight, or within the post-run grace window). */
export function isAgentEditActive(workspaceId: string): boolean {
  const state = windows.get(workspaceId);
  if (!state) {
    return false;
  }
  return state.active > 0 || (state.graceUntil > 0 && Date.now() < state.graceUntil);
}

/** Test-only: drop all tracked windows so suites don't bleed state. */
export function __resetAgentEditWindows(): void {
  for (const state of windows.values()) {
    if (state.graceTimer != null) {
      clearTimeout(state.graceTimer);
    }
  }
  windows.clear();
}
