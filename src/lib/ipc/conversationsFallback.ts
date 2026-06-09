import type {
  ConversationMessageRecord,
  ConversationSnapshot,
  ConversationSummary,
} from "./conversationsClient";

/**
 * Browser-preview fallback for conversation persistence.
 *
 * The desktop app persists conversations in a per-workspace SQLite vault via
 * Rust (`db/conversations.rs`, the authoritative implementation). The browser
 * has no vault, so it works against this ephemeral in-memory store, which
 * mirrors the same OPEN / ARCHIVE / DELETE semantics so the full
 * multi-conversation experience is exercisable in `pnpm dev` and in the
 * SSR-style store tests. It is deliberately *not* a second source of truth:
 * it has no OPFS backing and resets on reload.
 *
 * Timestamps come from a monotonic counter rather than `Date.now()` so
 * ordering (last-opened, last-updated) is total and deterministic — equal
 * millisecond stamps would make the sort unstable under rapid operations.
 */
interface FallbackRecord {
  conversationId: string;
  /** Explicit title, or null to fall back to the derived one. */
  title: string | null;
  harnessId: string | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  deletedAt: number | null;
  lastOpenedAt: number | null;
  contextFiles: string[];
  messages: ConversationMessageRecord[];
}

const TITLE_MAX_CHARS = 60;
const PREVIEW_MAX_CHARS = 120;

const byWorkspace = new Map<string, FallbackRecord[]>();
let idSeq = 0;
let clock = 0;

/** Monotonic, strictly-increasing logical timestamp. */
function tick(): number {
  clock += 1;
  return clock;
}

function records(workspaceId: string): FallbackRecord[] {
  let list = byWorkspace.get(workspaceId);
  if (!list) {
    list = [];
    byWorkspace.set(workspaceId, list);
  }
  return list;
}

function find(workspaceId: string, conversationId: string): FallbackRecord | undefined {
  return records(workspaceId).find(
    (record) => record.conversationId === conversationId && record.deletedAt === null,
  );
}

/** Truncate to at most `max` characters, appending an ellipsis when content
 * was dropped — mirrors `truncate_chars` in db/conversations.rs. */
function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) {
    return text;
  }
  return `${chars.slice(0, max).join("").trimEnd()}…`;
}

function firstUserMessage(record: FallbackRecord): string | null {
  return record.messages.find((message) => message.role === "user")?.content ?? null;
}

function resolveTitle(record: FallbackRecord): string {
  const explicit = record.title?.trim();
  if (explicit) {
    return truncate(explicit, TITLE_MAX_CHARS);
  }
  const derived = firstUserMessage(record)?.trim() ?? "";
  return derived ? truncate(derived, TITLE_MAX_CHARS) : "New conversation";
}

function makePreview(record: FallbackRecord): string {
  const first = record.messages[0]?.content.trim() ?? "";
  return truncate(first, PREVIEW_MAX_CHARS);
}

function toSummary(record: FallbackRecord): ConversationSummary {
  return {
    conversationId: record.conversationId,
    title: resolveTitle(record),
    harnessId: record.harnessId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messages.length,
    preview: makePreview(record),
    archived: record.archivedAt !== null,
    contextFiles: [...record.contextFiles],
  };
}

function toSnapshot(record: FallbackRecord): ConversationSnapshot {
  return {
    conversationId: record.conversationId,
    title: record.title,
    harnessId: record.harnessId,
    contextFiles: [...record.contextFiles],
    messages: record.messages.map((message) => ({ ...message })),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function fallbackListConversations(
  workspaceId: string,
  includeArchived: boolean,
): ConversationSummary[] {
  return records(workspaceId)
    .filter(
      (record) =>
        record.deletedAt === null && (includeArchived || record.archivedAt === null),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(toSummary);
}

/** The most-recently-*opened* non-archived non-deleted conversation. */
export function fallbackLoadActive(workspaceId: string): ConversationSnapshot | null {
  const candidate = records(workspaceId)
    .filter((record) => record.archivedAt === null && record.deletedAt === null)
    .sort((a, b) => {
      const aOpened = a.lastOpenedAt ?? -1;
      const bOpened = b.lastOpenedAt ?? -1;
      return bOpened - aOpened || b.updatedAt - a.updatedAt;
    })[0];
  return candidate ? toSnapshot(candidate) : null;
}

/** Open a conversation by id (bumps last-opened). */
export function fallbackLoadConversation(
  workspaceId: string,
  conversationId: string,
): ConversationSnapshot | null {
  const record = find(workspaceId, conversationId);
  if (!record) {
    return null;
  }
  record.lastOpenedAt = tick();
  return toSnapshot(record);
}

export function fallbackSaveConversation(
  workspaceId: string,
  conversationId: string,
  messages: ConversationMessageRecord[],
  contextFiles: string[],
): void {
  const now = tick();
  const existing = find(workspaceId, conversationId);
  if (existing) {
    existing.messages = messages.map((message) => ({ ...message }));
    existing.contextFiles = [...contextFiles];
    existing.updatedAt = now;
    return;
  }
  records(workspaceId).push({
    conversationId,
    title: null,
    harnessId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    lastOpenedAt: now,
    contextFiles: [...contextFiles],
    messages: messages.map((message) => ({ ...message })),
  });
}

export function fallbackNewConversation(workspaceId: string, harnessId: string): string {
  idSeq += 1;
  const conversationId = `local-conversation-${idSeq}`;
  const now = tick();
  records(workspaceId).push({
    conversationId,
    title: null,
    harnessId: harnessId || null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    lastOpenedAt: now,
    contextFiles: [],
    messages: [],
  });
  return conversationId;
}

export function fallbackRenameConversation(
  workspaceId: string,
  conversationId: string,
  title: string | null,
): void {
  const record = find(workspaceId, conversationId);
  if (record) {
    const trimmed = title?.trim();
    record.title = trimmed ? trimmed : null;
  }
}

export function fallbackArchiveConversation(
  workspaceId: string,
  conversationId: string,
  archived: boolean,
): void {
  const record = find(workspaceId, conversationId);
  if (record) {
    record.archivedAt = archived ? tick() : null;
  }
}

export function fallbackDeleteConversation(workspaceId: string, conversationId: string): void {
  const record = find(workspaceId, conversationId);
  if (record) {
    record.deletedAt = tick();
  }
}

export function fallbackDuplicateConversation(
  workspaceId: string,
  conversationId: string,
): string {
  const source = find(workspaceId, conversationId);
  if (!source) {
    throw new Error("conversation not found");
  }
  idSeq += 1;
  const newId = `local-conversation-${idSeq}`;
  const now = tick();
  records(workspaceId).push({
    conversationId: newId,
    title: `${resolveTitle(source)} (copy)`,
    harnessId: source.harnessId,
    createdAt: source.createdAt,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    lastOpenedAt: now,
    contextFiles: [...source.contextFiles],
    messages: source.messages.map((message, index) => ({
      ...message,
      messageId: `${newId}-m${index + 1}`,
    })),
  });
  return newId;
}

/** Test seam: wipe the in-memory store + counters between tests. */
export function _resetFallbackConversationsForTests(): void {
  byWorkspace.clear();
  idSeq = 0;
  clock = 0;
}
