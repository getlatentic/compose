import { describe, expect, it } from "vitest";
import { appendLlmMessage, loadLlmThread, recordLlmThread } from "./llmContextClient";

describe("llmContextClient runtime boundary", () => {
  it("does not persist or inspect LLM context outside the Tauri desktop runtime", async () => {
    await expect(
      recordLlmThread({
        contextItems: [],
        prompt: "Summarize",
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("Tauri desktop runtime");

    await expect(
      appendLlmMessage({
        body: "Done",
        llmThreadId: "thread-1",
        role: "assistant",
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("Tauri desktop runtime");

    await expect(
      loadLlmThread({
        llmThreadId: "thread-1",
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("Tauri desktop runtime");
  });
});
