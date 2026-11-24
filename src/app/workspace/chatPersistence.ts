import type { ConversationMessageRecord, ConversationSnapshot } from "../../lib/ipc/conversationsClient";
import { newMessageId } from "./chatRun";
import type { ChatExcerptRef, TraceEntry, WorkspaceChatMessage, WorkspaceChatThread, WorkspaceRunStats } from "./types";

/**
 * A chat thread to and from its saved conversation.
 */

/**
 * Serialize a thread's messages for persistence — `<role, content, trace,
 * stats, runStatus>` per message. `trace`/`stats` are JSON-stringified (the
 * trace is already the consolidated `TraceEntry[]`; no transform).
 *
 * A *live* reply is persisted (with `runStatus: "streaming"`) even before any
 * text lands, so an incremental save during the run leaves a marker a
 * quit/crash can't clear — on next load that stale "streaming" reads as
 * interrupted. A clean finish clears `streaming`, so a settled turn persists
 * with no status. Empty, non-streaming placeholders are still skipped.
 */
export function serializeChatMessages(
  thread: WorkspaceChatThread,
): ConversationMessageRecord[] {
  return thread.messages
    .filter((message) => message.content.trim() || message.streaming || message.interrupted)
    .map((message, index) => {
      const runStatus = message.streaming
        ? "streaming"
        : message.interrupted
          ? "interrupted"
          : undefined;
      return {
        messageId: message.id || newMessageId(),
        role: message.role,
        content: message.content,
        ...(message.trace?.length ? { traceJson: JSON.stringify(message.trace) } : {}),
        ...(message.stats ? { statsJson: JSON.stringify(message.stats) } : {}),
        ...(runStatus ? { runStatus } : {}),
        ...(message.excerpt ? { excerptJson: JSON.stringify(message.excerpt) } : {}),
        createdAt: index,
      };
    });
}

/**
 * Rebuild a chat thread from a persisted conversation snapshot, parsing
 * `traceJson`/`statsJson` back into `trace`/`stats` so a restored
 * assistant reply renders identically to live (bubble + "Show work" trace
 * + stats float). `contextItems` is preserved from the current thread
 * (the open-file context is live state, not persisted here).
 */
export function hydrateChatThread(
  thread: WorkspaceChatThread,
  snapshot: ConversationSnapshot,
): WorkspaceChatThread {
  const messages: WorkspaceChatMessage[] = snapshot.messages.map((record) => ({
    activity: null,
    content: record.content,
    id: record.messageId,
    role: record.role,
    ...(record.traceJson ? { trace: safeParseJson<TraceEntry[]>(record.traceJson) } : {}),
    ...(record.statsJson ? { stats: safeParseJson<WorkspaceRunStats>(record.statsJson) } : {}),
    ...(record.excerptJson ? { excerpt: safeParseJson<ChatExcerptRef>(record.excerptJson) } : {}),
    // A reply still marked streaming/interrupted on disk had its run cut short
    // (the app quit/crashed mid-stream) — there's no live run on load, so
    // surface it as interrupted with a Retry rather than a dead "thinking…".
    ...(record.runStatus === "streaming" || record.runStatus === "interrupted"
      ? { interrupted: true }
      : {}),
  }));
  return {
    ...thread,
    conversationId: snapshot.conversationId,
    messages,
    runError: null,
    runState: "idle",
  };
}

/** Parse persisted JSON, returning undefined on malformed data rather
 * than throwing — a corrupt row degrades to "no trace/stats", not a
 * crash that loses the whole conversation. */
function safeParseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
