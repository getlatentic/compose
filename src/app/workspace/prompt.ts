import type { WorkspaceChatMessage, WorkspaceCommentContextItem, WorkspaceContextItem, WorkspaceFileContextItem } from "./types";

/**
 * The prompt sent to an agent: the user's message with its context and the conversation so far.
 */

/**
 * How many *prior* turns of the conversation to replay into the prompt
 * for continuity. Caps prompt growth on a long conversation (oldest
 * turns drop first). A "turn" here is a single prior message (user or
 * assistant), so ~12 messages ≈ the last 6 exchanges.
 */
export const CONVERSATION_REPLAY_LIMIT = 12;

/**
 * Inline a file-context item's content only up to this many characters. A larger
 * file (or the pasted-text attachment) would crowd out a small (~4K) context
 * window, so it's referenced by path instead and the model reads it on demand
 * via the `read` tool. The single knob to tune for the context budget.
 */
export const FILE_CONTEXT_INLINE_LIMIT = 4000;

/**
 * Render the file-context block. With `inlineContent` (the openai-compatible /
 * local path), each item's content is inlined as `### <path>\n<content>` when
 * small enough, else reduced to a `- <path> (large; read it for details)`
 * pointer so a big attachment can't blow a small window. Without it (tool-native
 * CLI agents), every item is a bare `- <path>` reference the agent reads on
 * demand — smaller, always-current, cache-stable. Pure — takes the pre-fetched
 * content map so it stays unit-testable without IO.
 */
export function buildFileContextBlock(
  fileItems: WorkspaceFileContextItem[],
  contentByPath: Map<string, string>,
  inlineLimit = FILE_CONTEXT_INLINE_LIMIT,
  inlineContent = true,
): string {
  return fileItems
    .map((item) => {
      if (inlineContent) {
        const content = contentByPath.get(item.path);
        if (content != null && content.length <= inlineLimit) {
          return `### ${item.path}\n${content}`;
        }
        // An external file sits OUTSIDE the run's cwd, and the local
        // agent's sandboxed read tool refuses absolute paths — a bare
        // reference would be a dead end. Inline the head instead.
        if (item.origin === "external" && content != null) {
          return `### ${item.path} (beginning of the file — it continues beyond this excerpt)\n${content.slice(0, inlineLimit)}`;
        }
        return `- ${item.path} (large; read it for details)`;
      }
      return `- ${item.path}`;
    })
    .join("\n\n");
}

/**
 * Build the harness prompt: the prior-conversation transcript (for
 * continuity), then the open-file / comment context, then the new
 * prompt. The transcript is harness-neutral — it's just text every
 * harness receives, so bob / claude / codex all "remember" the
 * conversation without any native resume API.
 *
 * Only `<role, content>` is replayed — the answer and the user's words,
 * never the agent trace (that is display history, not model input). The
 * replay is capped at `CONVERSATION_REPLAY_LIMIT` most-recent prior
 * messages so a long thread can't blow the prompt size.
 *
 * File context carries each attached file's CONTENT (budgeted — see
 * {@link buildFileContextBlock}), so a small model can act on an attached chip
 * without a separate read. `contentByPath` is pre-fetched by the caller
 * (keeping this function pure); a path missing from it falls back to a
 * read-on-demand reference.
 */
export function createPromptWithContext(
  prompt: string,
  contextItems: WorkspaceContextItem[],
  priorMessages: WorkspaceChatMessage[] = [],
  contentByPath: Map<string, string> = new Map(),
  inlineContent = true,
) {
  const trimmedPrompt = prompt.trim();

  const transcript = buildConversationTranscript(priorMessages);

  const fileContext = buildFileContextBlock(
    contextItems.filter((item): item is WorkspaceFileContextItem => item.kind === "file"),
    contentByPath,
    FILE_CONTEXT_INLINE_LIMIT,
    inlineContent,
  );
  const commentContext = contextItems
    .filter((item): item is WorkspaceCommentContextItem => item.kind === "comment")
    .map(
      (item) =>
        [
          `File: ${item.filePath}`,
          `Byte range: ${item.range.start}-${item.range.end}`,
          `Selected text: ${item.selectedText}`,
          item.commentBody ? `Comment: ${item.commentBody}` : null,
          `Surrounding context: ${item.surroundingContext}`,
        ]
          .filter(Boolean)
          .join("\n"),
    )
    .join("\n\n");

  const blocks = [
    transcript ? `Conversation so far:\n${transcript}` : null,
    fileContext
      ? `Context files${
          inlineContent ? " (attached for reference)" : " (read these as needed)"
        }:\n${fileContext}`
      : null,
    // Scope edits to the intended files so the agent doesn't write to files the
    // user never asked it to touch. A prompt guardrail, not a hard sandbox
    // (clone mode is the hard version) — but it makes the intended target explicit.
    fileContext
      ? "When you edit files, only modify the Context files listed above. Do not create or change any other file unless I explicitly ask you to."
      : null,
    commentContext ? `Comment context:\n${commentContext}` : null,
  ].filter(Boolean);

  if (blocks.length === 0) {
    return trimmedPrompt;
  }
  return `${blocks.join("\n\n")}\n\n${trimmedPrompt}`;
}

/** A compact `User: … / Assistant: …` transcript of the most-recent
 * prior turns, content only (trace excluded), capped to the replay
 * limit. Empty string when there's nothing to replay. */
function buildConversationTranscript(priorMessages: WorkspaceChatMessage[]): string {
  const replayable = priorMessages.filter((message) => message.content.trim());
  const recent = replayable.slice(-CONVERSATION_REPLAY_LIMIT);
  if (recent.length === 0) {
    return "";
  }
  return recent
    .map((message) => {
      const speaker = message.role === "user" ? "User" : "Assistant";
      return `${speaker}: ${message.content.trim()}`;
    })
    .join("\n\n");
}
