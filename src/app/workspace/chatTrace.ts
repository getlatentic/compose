import type { ToolKind } from "../../lib/ipc/harnessClient";
import { ensureAssistantMessage } from "./chatRun";
import type { TraceEntry, WorkspaceChatThread, WorkspaceToolCall } from "./types";

/**
 * The trace of an agent's reply: its thinking and its tool calls.
 */

/**
 * Append a chunk of model reasoning to the active assistant message's
 * trace. Consecutive thinking deltas concatenate into the same `thinking`
 * entry; a tool/notice in between starts a fresh one. A no-op when `runId`
 * isn't the active run.
 */
export function appendAssistantThinking(
  chatThread: WorkspaceChatThread,
  runId: string,
  delta: string,
): WorkspaceChatThread {
  return appendTraceText(chatThread, runId, "thinking", delta);
}

/**
 * Shared body for the streaming text traces (`thinking` / `notice`):
 * concatenate the delta into the trailing entry when it is the same kind,
 * else push a new entry, preserving arrival order.
 */
export function appendTraceText(
  chatThread: WorkspaceChatThread,
  runId: string,
  kind: "thinking" | "notice",
  delta: string,
): WorkspaceChatThread {
  if (!delta || chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((message) => {
      if (message.id !== messageId) {
        return message;
      }
      const trace = message.trace ?? [];
      const last = trace[trace.length - 1];
      // Concatenate into the trailing entry when it's the same streaming
      // kind; otherwise start a fresh entry (preserving arrival order).
      const prevText = last && last.kind === kind && "text" in last ? last.text : null;
      if (prevText !== null) {
        const merged = makeTextEntry(kind, prevText + delta);
        return { ...message, trace: [...trace.slice(0, -1), merged] };
      }
      // Don't start a brand-new entry for a whitespace-only delta: bob
      // emits a "\n\n" message after a tool, which would otherwise become
      // a blank trace step / blank status line. Real text that merely
      // *begins* with whitespace still concatenates (handled above).
      if (!delta.trim()) {
        return message;
      }
      return { ...message, trace: [...trace, makeTextEntry(kind, delta)] };
    }),
  };
}

/** Build a `thinking`/`notice` trace entry from a literal kind (keeps the
 * discriminated union sound — a `"thinking" | "notice"` variable can't be
 * assigned to `TraceEntry` directly). */
function makeTextEntry(kind: "thinking" | "notice", text: string): TraceEntry {
  return kind === "thinking" ? { kind: "thinking", text } : { kind: "notice", text };
}

/**
 * Append a running tool call to the active assistant message's trace
 * (deduped by id), capturing its `input`. Pushed in arrival order so it
 * interleaves with reasoning/narration. A no-op when `runId` isn't the
 * active run.
 */
export function startAssistantToolCall(
  chatThread: WorkspaceChatThread,
  runId: string,
  toolCallId: string,
  name: string,
  kind: ToolKind,
  input?: string | null,
): WorkspaceChatThread {
  if (chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((message) => {
      if (message.id !== messageId) {
        return message;
      }
      const trace = message.trace ?? [];
      if (trace.some((entry) => entry.kind === "tool" && entry.tool.id === toolCallId)) {
        return message;
      }
      const tool: WorkspaceToolCall = {
        id: toolCallId,
        name,
        kind,
        status: "running",
        ...(input ? { input } : {}),
      };
      return { ...message, trace: [...trace, { kind: "tool", tool }] };
    }),
  };
}

/**
 * Flip a tool call's status to done/error (matched by id) in the active
 * assistant message's trace, recording its `output`.
 */
export function endAssistantToolCall(
  chatThread: WorkspaceChatThread,
  runId: string,
  toolCallId: string,
  ok: boolean,
  output?: string | null,
): WorkspaceChatThread {
  if (chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((message) => {
      if (message.id !== messageId || !message.trace) {
        return message;
      }
      return {
        ...message,
        trace: message.trace.map((entry) =>
          entry.kind === "tool" && entry.tool.id === toolCallId
            ? {
                kind: "tool",
                tool: {
                  ...entry.tool,
                  status: ok ? ("done" as const) : ("error" as const),
                  ...(output ? { output } : {}),
                },
              }
            : entry,
        ),
      };
    }),
  };
}
