import { spillChatInput } from "../../lib/ipc/harnessClient";

/**
 * Above this many characters (~2000 tokens), a chat message is spilled to a file
 * the model reads on demand instead of being carried inline in the first turn —
 * one big paste would otherwise blow a small (~4K) context window before the
 * model starts. Conservative for small local models; the single knob to tune.
 */
export const SPILL_THRESHOLD = 8000;

/** How much of the spilled text to inline as a preview, so the model has a head
 * start on what the file holds without reading it. */
const SPILL_HEAD_CHARS = 800;

/**
 * The short inline text that replaces a spilled message in the *sent* prompt: a
 * pointer to the file, its size, and a head preview. Pure (no IO) so the rewrite
 * is unit-testable without the IPC round-trip.
 */
export function buildSpilledPromptReference(
  path: string,
  fullText: string,
): string {
  const head = fullText.slice(0, SPILL_HEAD_CHARS);
  return (
    `[Large input saved to ${path} (${fullText.length} chars). ` +
    `Read it with the read tool (offset/limit). First ${SPILL_HEAD_CHARS} chars:]\n` +
    head
  );
}

/** Whether a message is large enough to spill. Pure. */
export function shouldSpillChatInput(text: string): boolean {
  return text.length > SPILL_THRESHOLD;
}

/** The chip label for a spilled paste — its size in KB (1 dp for the small end).
 * Pure, so the paste handler's labelling is unit-testable. */
export function pastedTextChipLabel(text: string): string {
  const kb = text.length / 1024;
  const rounded = kb >= 10 ? Math.round(kb) : Math.round(kb * 10) / 10;
  return `Pasted text (${rounded} KB)`;
}

/**
 * Return the text to *send* for a user message: the original when it's small
 * enough, otherwise a short reference to a scratch file the spilled full text was
 * written to (read on demand by the model). Best-effort — if the spill IPC fails
 * the original inline text is sent rather than dropping the user's message. Only
 * the sent prompt changes; the chat-visible message stays the full original.
 */
export async function spillChatInputForPrompt(
  workspaceId: string,
  userMessage: string,
): Promise<string> {
  if (!shouldSpillChatInput(userMessage)) {
    return userMessage;
  }
  try {
    const path = await spillChatInput(workspaceId, userMessage);
    return buildSpilledPromptReference(path, userMessage);
  } catch {
    return userMessage;
  }
}
