/** A message in a form both the live thread and a loaded snapshot satisfy. */
export interface ExportableMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Serialize a conversation to a self-contained Markdown transcript — a top
 * heading with the conversation title, then one `## You` / `## Assistant`
 * section per settled turn (empty messages are skipped). The agent's trace is
 * intentionally omitted; the export is the readable conversation, not the
 * tool log.
 */
export function conversationToMarkdown(
  title: string,
  messages: ExportableMessage[],
): string {
  const heading = title.trim() || "New conversation";
  const blocks: string[] = [`# ${heading}`];

  for (const message of messages) {
    const content = message.content.trim();
    if (!content) {
      continue;
    }
    const speaker = message.role === "user" ? "You" : "Assistant";
    blocks.push(`## ${speaker}\n\n${content}`);
  }

  return `${blocks.join("\n\n")}\n`;
}
