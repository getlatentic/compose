import { invoke } from "@tauri-apps/api/core";

/** LaunchServices state for the Markdown content type (#113). Off-macOS (and
 *  in the browser preview) the commands reject — callers treat that as
 *  "unavailable" and hide the affordance. */
export interface MarkdownHandlerStatus {
  isDefault: boolean;
  /** Bundle id of the current default app, when one is set. */
  currentHandler: string | null;
}

export async function markdownHandlerStatus(): Promise<MarkdownHandlerStatus> {
  return invoke<MarkdownHandlerStatus>("markdown_handler_status");
}

export async function setDefaultMarkdownHandler(): Promise<MarkdownHandlerStatus> {
  return invoke<MarkdownHandlerStatus>("set_default_markdown_handler");
}
