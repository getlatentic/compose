import { reportClientError } from "../../lib/diagnostics/errorReporter";
import type { HarnessRunEvent } from "../../lib/ipc/harnessClient";
import {
  appendAssistantNotice,
  appendAssistantSuggestions,
  appendAssistantText,
  appendAssistantThinking,
  assistantMessageContentForRun,
  endAssistantToolCall,
  markRunStreaming,
  prepareWorkspaceSuggestionDrafts,
  setAssistantActivity,
  setAssistantSession,
  setAssistantStats,
  startAssistantToolCall,
  type Workspace,
  type FinalizeRunOptions,
  type WorkspaceChatThread,
} from "../workspaceModel";
import { updateWorkspace } from "./internals";

/** Live `subscribeHarnessRun` teardowns keyed by runId, so a cancel/finish can
 * detach the listener. Module-level: there is exactly one store per window. */
export const activeRunSubscriptions = new Map<string, () => void>();

export function unsubscribeRun(runId: string) {
  const unsubscribe = activeRunSubscriptions.get(runId);
  if (unsubscribe) {
    unsubscribe();
    activeRunSubscriptions.delete(runId);
  }
}

export function handleHarnessRunEvent(
  event: HarnessRunEvent,
  runId: string,
  updateWorkspaceForRun: (updater: (current: Workspace) => Workspace) => void,
  finalize: (options: FinalizeRunOptions) => void,
  onFinished?: (result: { cancelled: boolean }) => void,
) {
  if (event.runId !== runId) {
    return;
  }
  // The Rust side now emits the normalized `compose_core::RunEvent`
  // stream (bob's stream-json is parsed into these by the harness
  // adapter), so this handler never parses a harness wire format —
  // it just applies already-decoded events. See `harnessClient.ts`.
  // Each event appends to the active message's ordered trace (or the
  // answer bubble for `text`); the live status indicator is derived from
  // the trace's last entry in the UI, so this handler sets no status.
  switch (event.kind) {
    case "started":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: markRunStreaming(current.chatThread, runId),
      }));
      return;
    case "text":
      // The answer (bob: only attempt_completion; Claude/Codex: streamed
      // text). Goes to the bubble, replacing the live status.
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: appendAssistantText(current.chatThread, runId, event.delta),
      }));
      return;
    case "notice":
      // Narration — appended to the trace (and the last entry drives the
      // live status indicator).
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: appendAssistantNotice(current.chatThread, runId, event.message),
      }));
      return;
    case "thinking":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: appendAssistantThinking(current.chatThread, runId, event.delta),
      }));
      return;
    case "toolStart":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: startAssistantToolCall(
          current.chatThread,
          runId,
          event.toolCallId,
          event.name,
          event.toolKind,
          event.input,
        ),
      }));
      return;
    case "toolEnd":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: endAssistantToolCall(current.chatThread, runId, event.toolCallId, event.ok, event.output),
      }));
      return;
    case "session":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: setAssistantSession(current.chatThread, runId, event.sessionId),
      }));
      return;
    case "usage":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: setAssistantStats(current.chatThread, runId, {
          ...(event.totalTokens != null ? { totalTokens: event.totalTokens } : {}),
          ...(event.toolCalls != null ? { toolCalls: event.toolCalls } : {}),
          ...(event.coins != null ? { coins: event.coins } : {}),
        }),
      }));
      return;
    case "suggestedEdits": {
      // Wire edits omit `title` when absent; the app shape wants
      // `null`. Map once, then prepare drafts (needs the workspace
      // content + PositionMapper, which is why this stays TS-side).
      const inputs = event.edits.map((edit) => ({
        filePath: edit.filePath,
        range: edit.range,
        replacement: edit.replacement,
        title: edit.title ?? null,
      }));
      updateWorkspaceForRun((current) => {
        const prepared = prepareWorkspaceSuggestionDrafts(current, inputs);
        let chatThread = appendAssistantSuggestions(
          current.chatThread,
          runId,
          prepared.drafts,
          Date.now(),
        );
        if (prepared.rejectedCount > 0) {
          chatThread = setAssistantActivity(
            chatThread,
            runId,
            `${prepared.rejectedCount} suggested edit${prepared.rejectedCount === 1 ? "" : "s"} could not be prepared`,
          );
        }
        return { ...current, chatThread };
      });
      return;
    }
    case "activity":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: setAssistantActivity(current.chatThread, runId, event.message),
      }));
      return;
    case "error":
      finalize({ errorMessage: event.message });
      void reportClientError("agentRun", event.message);
      return;
    case "exited":
      finalize({ cancelled: event.cancelled, exitCode: event.exitCode });
      // Terminal: a reviewed run now diffs its sandbox and surfaces the
      // changes for approval (or tears the sandbox down). `error` always
      // precedes `exited`, so this fires exactly once per run.
      onFinished?.({ cancelled: event.cancelled });
      return;
    default:
      return;
  }
}

export type SetWorkspaceState = (
  partial: (state: { workspaces: Workspace[] }) => { workspaces: Workspace[] },
) => void;

/**
 * rAF-batched setter for streaming runs.
 *
 * The harness emits one event per token (and parsers emit several state
 * changes per stdout line — text append, activity update, suggestion
 * prep). Without batching, each event triggers a full Zustand
 * notification → React render → renderer paint. At streaming speeds
 * (~50+ events/sec) this saturates the main thread and the whole UI
 * stalls.
 *
 * Strategy: queue updaters, coalesce into one `set()` per animation
 * frame. The updaters are `(workspace) => workspace`, so folding
 * `N` of them is a linear pass that produces a single state
 * transition. `flushNow()` forces a synchronous flush for terminal
 * events (finalize / error) where the next set() must observe all
 * queued work.
 *
 * One batcher per run — finalize disposes it. No global queue, no
 * cross-run interleaving.
 */
export function createBatchedRunSetter(set: SetWorkspaceState, workspaceId: string) {
  let pending: Array<(current: Workspace) => Workspace> = [];
  let rafHandle: number | null = null;

  const flush = () => {
    rafHandle = null;
    if (pending.length === 0) {
      return;
    }
    const updaters = pending;
    pending = [];
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => {
        let next = item;
        for (const updater of updaters) {
          next = updater(next);
        }
        return next;
      }),
    }));
  };

  const schedule = () => {
    if (rafHandle != null) {
      return;
    }
    if (typeof requestAnimationFrame === "function") {
      rafHandle = requestAnimationFrame(flush);
    } else {
      // SSR / test fallback — flush on next microtask.
      rafHandle = 1;
      queueMicrotask(() => {
        rafHandle = null;
        flush();
      });
    }
  };

  return {
    updateWorkspaceForRun(updater: (current: Workspace) => Workspace) {
      pending.push(updater);
      schedule();
    },
    updateThread(updater: (current: WorkspaceChatThread) => WorkspaceChatThread) {
      pending.push((workspace) => ({ ...workspace, chatThread: updater(workspace.chatThread) }));
      schedule();
    },
    flushNow() {
      if (rafHandle != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafHandle);
      }
      rafHandle = null;
      flush();
    },
    dispose() {
      if (rafHandle != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafHandle);
      }
      rafHandle = null;
      pending = [];
    },
  };
}

export function persistedRunBody(
  thread: WorkspaceChatThread,
  runId: string,
  options: FinalizeRunOptions,
) {
  const assistantBody = assistantMessageContentForRun(thread, runId);
  if (assistantBody) {
    return { body: assistantBody, role: "assistant" as const };
  }
  if (options.cancelled) {
    return { body: "Run cancelled", role: "system" as const };
  }
  if (options.errorMessage) {
    return { body: options.errorMessage, role: "system" as const };
  }
  if (typeof options.exitCode === "number" && options.exitCode !== 0) {
    return { body: `The assistant exited with code ${options.exitCode}`, role: "system" as const };
  }
  return null;
}
