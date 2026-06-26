import type { WorkspaceStoreGet } from "./types";
import { persistConversation } from "./persistence";

/** How often the in-flight reply is saved while a run streams. Small enough
 *  that a crash loses at most a few seconds of the reply. */
const PERSIST_INTERVAL_MS = 3000;

export interface RunPersister {
  /** Mark the conversation dirty so the next tick saves it. Call per run event. */
  noteEvent(): void;
  /** Stop the timer. Call once on the run's terminal event (the final,
   *  list-refreshing save is the caller's job). */
  dispose(): void;
}

/**
 * Throttled incremental persistence for a streaming run, so a quit/crash
 * mid-stream keeps the partial reply instead of losing the whole turn. Each
 * save tags the in-flight reply `runStatus:"streaming"` (via
 * `serializeChatMessages`); a clean finish clears it, so the marker only
 * survives an actual interruption — which load reads as interrupted (see
 * `hydrateChatThread`). The history-list refresh is suppressed so a streaming
 * turn doesn't churn the sidebar; the final save on completion refreshes it.
 */
export function createRunPersister(get: WorkspaceStoreGet, workspaceId: string): RunPersister {
  let dirty = false;
  const timer = setInterval(() => {
    if (!dirty) {
      return;
    }
    dirty = false;
    void persistConversation(get, workspaceId, { refreshList: false });
  }, PERSIST_INTERVAL_MS);

  return {
    noteEvent() {
      dirty = true;
    },
    dispose() {
      clearInterval(timer);
    },
  };
}
