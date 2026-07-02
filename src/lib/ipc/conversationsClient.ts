import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import {
  fallbackArchiveConversation,
  fallbackDeleteConversation,
  fallbackDuplicateConversation,
  fallbackListConversations,
  fallbackLoadActive,
  fallbackLoadConversation,
  fallbackNewConversation,
  fallbackRenameConversation,
  fallbackSaveConversation,
  _resetFallbackConversationsForTests as resetFallback,
} from "./conversationsFallback";

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
  /** Run lifecycle: `"streaming"` while a reply is being written, cleared once
   * it settles. A reply still `"streaming"` on load means its run never
   * finished (quit/crash mid-stream) — read as interrupted. */
  runStatus?: string | null;
  /** The commented excerpt (file, line:col, quoted text, note) as JSON, on
   * comment-to-chat messages — so the chat rebuilds its excerpt card after a
   * reload instead of falling back to the raw prompt text. Mirrors
   * `excerpt_json`. */
  excerptJson?: string | null;
  createdAt: number;
}

/** A whole conversation restored into the open chat thread. `title` is the
 * raw stored title (often null); the display title lives on
 * {@link ConversationSummary}. Mirrors `compose::db::ConversationSnapshot`. */
export interface ConversationSnapshot {
  conversationId: string;
  title: string | null;
  harnessId: string | null;
  contextFiles: string[];
  messages: ConversationMessageRecord[];
  createdAt: number;
  updatedAt: number;
}

/** A history-list entry — enough to render a row without loading every
 * message. `title` and `preview` are derived server-side and never blank.
 * Mirrors `compose::db::ConversationSummary`. */
export interface ConversationSummary {
  conversationId: string;
  title: string;
  harnessId: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
  archived: boolean;
  contextFiles: string[];
}

/** Every non-deleted conversation as a history summary, newest first.
 * Archived ones appear only when `includeArchived` is set. */
export async function listConversations(
  workspaceId: string,
  includeArchived: boolean,
): Promise<ConversationSummary[]> {
  if (!isTauriRuntime()) {
    return fallbackListConversations(workspaceId, includeArchived);
  }
  return invoke<ConversationSummary[]>("conversation_list", { workspaceId, includeArchived });
}

/** The most-recently-opened non-archived non-deleted conversation, restored
 * on workspace load. */
export async function loadActiveConversation(
  workspaceId: string,
): Promise<ConversationSnapshot | null> {
  if (!isTauriRuntime()) {
    return fallbackLoadActive(workspaceId);
  }
  return invoke<ConversationSnapshot | null>("conversation_load_active", { workspaceId });
}

/** Open a specific conversation by id, bumping its `last_opened_at`. */
export async function loadConversation(
  workspaceId: string,
  conversationId: string,
): Promise<ConversationSnapshot | null> {
  if (!isTauriRuntime()) {
    return fallbackLoadConversation(workspaceId, conversationId);
  }
  return invoke<ConversationSnapshot | null>("conversation_load", {
    workspaceId,
    conversationId,
  });
}

export async function saveConversation(
  workspaceId: string,
  conversationId: string,
  messages: ConversationMessageRecord[],
  contextFiles: string[],
): Promise<void> {
  if (!isTauriRuntime()) {
    fallbackSaveConversation(workspaceId, conversationId, messages, contextFiles);
    return;
  }
  await invoke<void>("conversation_save", {
    workspaceId,
    conversationId,
    messages,
    contextFiles,
  });
}

export async function newConversation(
  workspaceId: string,
  harnessId: string,
): Promise<string> {
  if (!isTauriRuntime()) {
    return fallbackNewConversation(workspaceId, harnessId);
  }
  return invoke<string>("conversation_new", { workspaceId, harnessId });
}

/** Set (or clear, with null) a conversation's explicit title. */
export async function renameConversation(
  workspaceId: string,
  conversationId: string,
  title: string | null,
): Promise<void> {
  if (!isTauriRuntime()) {
    fallbackRenameConversation(workspaceId, conversationId, title);
    return;
  }
  await invoke<void>("conversation_rename", { workspaceId, conversationId, title });
}

/** Archive (`true`) or un-archive (`false`) a conversation. */
export async function archiveConversation(
  workspaceId: string,
  conversationId: string,
  archived: boolean,
): Promise<void> {
  if (!isTauriRuntime()) {
    fallbackArchiveConversation(workspaceId, conversationId, archived);
    return;
  }
  await invoke<void>("conversation_archive", { workspaceId, conversationId, archived });
}

/** Soft-delete a conversation into the recoverable trash. */
export async function deleteConversation(
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  if (!isTauriRuntime()) {
    fallbackDeleteConversation(workspaceId, conversationId);
    return;
  }
  await invoke<void>("conversation_delete", { workspaceId, conversationId });
}

/** Duplicate a conversation; returns the new conversation id. */
export async function duplicateConversation(
  workspaceId: string,
  conversationId: string,
): Promise<string> {
  if (!isTauriRuntime()) {
    return fallbackDuplicateConversation(workspaceId, conversationId);
  }
  return invoke<string>("conversation_duplicate", { workspaceId, conversationId });
}

export function _resetFallbackConversationsForTests() {
  resetFallback();
}
