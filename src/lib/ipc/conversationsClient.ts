import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";

/**
 * One persisted chat turn. `traceJson` / `statsJson` are opaque strings —
 * the TS model layer owns their shape (the consolidated `TraceEntry[]` and
 * `WorkspaceRunStats`); Rust just round-trips them. Mirrors
 * `compose::db::ConversationMessageRecord`.
 */
export interface ConversationMessageRecord {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  traceJson?: string | null;
  statsJson?: string | null;
  createdAt: number;
}

/** The active (non-archived) conversation restored on workspace load. */
export interface ConversationSnapshot {
  conversationId: string;
  title: string | null;
  harnessId: string | null;
  messages: ConversationMessageRecord[];
  createdAt: number;
  updatedAt: number;
}

// Browser-preview fallback: an in-memory map so the app degrades to an
// ephemeral conversation (no SQLite vault outside Tauri), mirroring
// `commentsClient`. The browser can't run a harness anyway.
const fallbackByWorkspace = new Map<string, ConversationSnapshot>();
let fallbackSeq = 0;

export async function loadActiveConversation(
  workspaceId: string,
): Promise<ConversationSnapshot | null> {
  if (!isTauriRuntime()) {
    return fallbackByWorkspace.get(workspaceId) ?? null;
  }
  return invoke<ConversationSnapshot | null>("conversation_load_active", { workspaceId });
}

export async function saveConversation(
  workspaceId: string,
  conversationId: string,
  messages: ConversationMessageRecord[],
): Promise<void> {
  if (!isTauriRuntime()) {
    const now = fallbackByWorkspace.get(workspaceId)?.createdAt ?? 0;
    fallbackByWorkspace.set(workspaceId, {
      conversationId,
      title: null,
      harnessId: null,
      messages: messages.map((message) => ({ ...message })),
      createdAt: now,
      updatedAt: now,
    });
    return;
  }
  await invoke<void>("conversation_save", { workspaceId, conversationId, messages });
}

export async function newConversation(
  workspaceId: string,
  harnessId: string,
): Promise<string> {
  if (!isTauriRuntime()) {
    fallbackSeq += 1;
    const conversationId = `local-conversation-${fallbackSeq}`;
    fallbackByWorkspace.set(workspaceId, {
      conversationId,
      title: null,
      harnessId,
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    });
    return conversationId;
  }
  return invoke<string>("conversation_new", { workspaceId, harnessId });
}

export function _resetFallbackConversationsForTests() {
  fallbackByWorkspace.clear();
  fallbackSeq = 0;
}
