import { appendTraceText } from "./chatTrace";
import type { ChatExcerptRef, WorkspaceChatMessage, WorkspaceChatThread, WorkspaceRunStats } from "./types";

/**
 * An agent run in the chat thread, as its events arrive.
 */

/**
 * Sum the per-message usage stats across a whole thread, for the header
 * total. Messages without stats (user turns, in-flight assistant turns)
 * contribute nothing.
 */
export function sumChatThreadStats(thread: WorkspaceChatThread): WorkspaceRunStats {
  let totalTokens = 0;
  let coins = 0;
  for (const message of thread.messages) {
    totalTokens += message.stats?.totalTokens ?? 0;
    coins += message.stats?.coins ?? 0;
  }
  return { totalTokens, coins };
}

/** A globally-unique chat-message id. `conversation_messages.message_id` is a
 *  global primary key, so a per-conversation scheme like `message-1` collides
 *  the moment a second conversation persists its first message. */
export function newMessageId(): string {
  return crypto.randomUUID();
}

export function appendUserChatMessage(
  chatThread: WorkspaceChatThread,
  userContent: string,
  preparedCommand: string | null,
  llmThreadId: string | null = null,
  excerpt: ChatExcerptRef | null = null,
): WorkspaceChatThread {
  const trimmedUserContent = userContent.trim();
  if (!trimmedUserContent) {
    return chatThread;
  }

  return {
    ...chatThread,
    messages: [
      ...chatThread.messages,
      {
        activity: null,
        content: trimmedUserContent,
        id: newMessageId(),
        ...(llmThreadId ? { llmThreadId } : {}),
        ...(excerpt ? { excerpt } : {}),
        role: "user",
      },
    ],
    preparedCommand,
    prompt: "",
  };
}

export function startRun(
  chatThread: WorkspaceChatThread,
  runId: string,
  llmThreadId: string | null = null,
  agentName?: string,
): WorkspaceChatThread {
  return {
    ...chatThread,
    activeAgentName: agentName,
    activeLlmThreadId: llmThreadId,
    activeRunId: runId,
    runError: null,
    runState: "starting",
  };
}

export function markRunStreaming(
  chatThread: WorkspaceChatThread,
  runId: string,
): WorkspaceChatThread {
  if (chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const placeholder: WorkspaceChatMessage = {
    activity: null,
    content: "",
    id: newMessageId(),
    ...(chatThread.activeLlmThreadId ? { llmThreadId: chatThread.activeLlmThreadId } : {}),
    ...(chatThread.activeAgentName ? { agentName: chatThread.activeAgentName } : {}),
    role: "assistant",
    runId,
    streaming: true,
  };
  return {
    ...chatThread,
    messages: [...chatThread.messages, placeholder],
    runState: "streaming",
  };
}

export function ensureAssistantMessage(
  chatThread: WorkspaceChatThread,
  runId: string,
): { thread: WorkspaceChatThread; messageId: string } {
  const last = chatThread.messages[chatThread.messages.length - 1];
  if (last && last.role === "assistant" && last.runId === runId) {
    return { thread: chatThread, messageId: last.id };
  }
  const placeholder: WorkspaceChatMessage = {
    activity: null,
    content: "",
    id: newMessageId(),
    ...(chatThread.activeLlmThreadId ? { llmThreadId: chatThread.activeLlmThreadId } : {}),
    ...(chatThread.activeAgentName ? { agentName: chatThread.activeAgentName } : {}),
    role: "assistant",
    runId,
    streaming: true,
  };
  return {
    thread: { ...chatThread, messages: [...chatThread.messages, placeholder] },
    messageId: placeholder.id,
  };
}

export function appendAssistantText(
  chatThread: WorkspaceChatThread,
  runId: string,
  text: string,
): WorkspaceChatThread {
  if (!text || chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((message) =>
      message.id === messageId ? { ...message, content: message.content + text } : message,
    ),
  };
}

/**
 * Append a chunk of agent *narration* to the active assistant message's
 * trace (the intermediate "what I'm doing" text — never the answer).
 * Consecutive notice deltas concatenate into the same `notice` entry; the
 * last entry drives the live status indicator.
 */
export function appendAssistantNotice(
  chatThread: WorkspaceChatThread,
  runId: string,
  delta: string,
): WorkspaceChatThread {
  return appendTraceText(chatThread, runId, "notice", delta);
}

/** Record the harness session id on the active assistant message (trace). */
export function setAssistantSession(
  chatThread: WorkspaceChatThread,
  runId: string,
  sessionId: string,
): WorkspaceChatThread {
  if (!sessionId || chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((item) =>
      item.id === messageId ? { ...item, sessionId } : item,
    ),
  };
}

/** Record terminal usage stats on the active assistant message. */
export function setAssistantStats(
  chatThread: WorkspaceChatThread,
  runId: string,
  stats: WorkspaceRunStats,
): WorkspaceChatThread {
  if (chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((item) =>
      item.id === messageId ? { ...item, stats } : item,
    ),
  };
}

export function setAssistantActivity(
  chatThread: WorkspaceChatThread,
  runId: string,
  activity: string | null,
): WorkspaceChatThread {
  if (chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((message) =>
      message.id === messageId ? { ...message, activity } : message,
    ),
  };
}

export function assistantMessageContentForRun(chatThread: WorkspaceChatThread, runId: string) {
  const message = [...chatThread.messages]
    .reverse()
    .find((item) => item.role === "assistant" && item.runId === runId);
  return message?.content.trim() ?? "";
}

export interface FinalizeRunOptions {
  cancelled?: boolean;
  errorMessage?: string | null;
  exitCode?: number | null;
}

export function finalizeRun(
  chatThread: WorkspaceChatThread,
  runId: string,
  options: FinalizeRunOptions = {},
): WorkspaceChatThread {
  if (chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { cancelled, errorMessage, exitCode } = options;
  const hasFailure =
    Boolean(errorMessage) ||
    (typeof exitCode === "number" && exitCode !== 0 && !cancelled);

  const messages = chatThread.messages.map((message) => {
    if (message.runId !== runId || message.role !== "assistant") {
      return message;
    }
    let activity = message.activity;
    if (cancelled) {
      activity = "Cancelled";
    } else if (errorMessage) {
      activity = errorMessage;
    } else if (typeof exitCode === "number" && exitCode !== 0) {
      activity = `The assistant exited with code ${exitCode}`;
    } else {
      activity = null;
    }
    // The run is over: clearing `streaming` retires the live status
    // indicator (which is derived from the trace + streaming). The trace
    // itself is preserved.
    return { ...message, streaming: false, activity };
  });

  return {
    ...chatThread,
    activeLlmThreadId: null,
    activeRunId: null,
    messages,
    runError: hasFailure ? errorMessage ?? `The assistant exited with code ${exitCode ?? "?"}` : null,
    runState: hasFailure ? "error" : "idle",
  };
}

/**
 * Clear a thread for "New chat": drop messages + run state, keep the live
 * `contextItems` (the open file stays as context). `conversationId` is
 * reset by the caller to the freshly-created id.
 */
export function resetChatThread(thread: WorkspaceChatThread): WorkspaceChatThread {
  return {
    ...thread,
    activeLlmThreadId: null,
    activeRunId: null,
    conversationId: null,
    messages: [],
    preparedCommand: null,
    prompt: "",
    runError: null,
    runState: "idle",
  };
}
