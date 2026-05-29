import { invoke } from "@tauri-apps/api/core";
import type { CommentAnchor, SourceRange } from "../../features/comments/commentModel";
import { isTauriRuntime } from "../runtime/desktopRuntime";

export interface LlmContextSnapshotRequest {
  anchor?: CommentAnchor;
  filePath: string;
  kind: "comment" | "file";
  selectedTextSnapshot?: string;
  sourceCommentId?: string;
  sourceRange?: SourceRange;
  surroundingContextSnapshot?: string;
}

export interface LlmThreadRecordRequest {
  contextItems: LlmContextSnapshotRequest[];
  prompt: string;
  workspaceId: string;
}

export interface LlmThreadRecordResult {
  llmThreadId: string;
}

export interface LlmMessageAppendRequest {
  body: string;
  llmThreadId: string;
  role: "assistant" | "system" | "tool" | "user";
  workspaceId: string;
}

export interface LlmThreadLoadRequest {
  llmThreadId: string;
  workspaceId: string;
}

export interface LlmThreadSnapshot {
  contextItems: LlmContextSnapshotRecord[];
  createdAt: number;
  llmThreadId: string;
  messages: LlmMessageRecord[];
  sourceId?: string | null;
  sourceKind: string;
  title?: string | null;
  updatedAt: number;
}

export interface LlmMessageRecord {
  body: string;
  createdAt: number;
  llmMessageId: string;
  role: "assistant" | "system" | "tool" | "user";
}

export interface LlmContextSnapshotRecord {
  anchor?: CommentAnchor | null;
  contextItemId: string;
  createdAt: number;
  currentPath?: string | null;
  docId?: string | null;
  documentRevisionId?: string | null;
  selectedTextSnapshot?: string | null;
  sourceRange?: SourceRange | null;
  surroundingContextSnapshot?: string | null;
}

export async function recordLlmThread(
  request: LlmThreadRecordRequest,
): Promise<LlmThreadRecordResult> {
  if (!isTauriRuntime()) {
    throw new Error("LLM context persistence requires the Tauri desktop runtime.");
  }

  return invoke<LlmThreadRecordResult>("metadata_record_llm_thread", { request });
}

export async function appendLlmMessage(request: LlmMessageAppendRequest): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("LLM message persistence requires the Tauri desktop runtime.");
  }

  await invoke<void>("metadata_append_llm_message", { request });
}

export async function loadLlmThread(request: LlmThreadLoadRequest): Promise<LlmThreadSnapshot> {
  if (!isTauriRuntime()) {
    throw new Error("LLM context inspection requires the Tauri desktop runtime.");
  }

  return invoke<LlmThreadSnapshot>("metadata_load_llm_thread", { request });
}
