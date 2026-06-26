import { describe, expect, it } from "vitest";
import {
  buildSpilledPromptReference,
  pastedTextChipLabel,
  shouldSpillChatInput,
  spillChatInputForPrompt,
  SPILL_THRESHOLD,
} from "./chatInputSpill";

describe("chat input spill", () => {
  it("only spills past the threshold", () => {
    expect(shouldSpillChatInput("short")).toBe(false);
    expect(shouldSpillChatInput("x".repeat(SPILL_THRESHOLD))).toBe(false);
    expect(shouldSpillChatInput("x".repeat(SPILL_THRESHOLD + 1))).toBe(true);
  });

  it("builds a reference with the path, full size, and a head preview", () => {
    const full = "A".repeat(5000);
    const ref = buildSpilledPromptReference("/tmp/compose/chat-input/w-1.md", full);
    expect(ref).toContain("/tmp/compose/chat-input/w-1.md");
    expect(ref).toContain("(5000 chars)");
    expect(ref).toContain("read tool");
    // The preview is only the head, never the whole text.
    expect(ref.length).toBeLessThan(full.length);
    expect(ref.endsWith("A".repeat(800))).toBe(true);
  });

  it("returns the message unchanged when it is small", async () => {
    const msg = "a normal message";
    expect(await spillChatInputForPrompt("workspace-1", msg)).toBe(msg);
  });

  it("falls back to the original text when the spill IPC is unavailable", async () => {
    // Outside the Tauri runtime (as under vitest) the spill command throws; the
    // user's message must still be sent inline rather than dropped.
    const big = "x".repeat(SPILL_THRESHOLD + 100);
    expect(await spillChatInputForPrompt("workspace-1", big)).toBe(big);
  });

  it("labels a spilled paste with its size in KB", () => {
    expect(pastedTextChipLabel("x".repeat(2048))).toBe("Pasted text (2 KB)");
    // The small end keeps one decimal so a sub-KB paste isn't "0 KB".
    expect(pastedTextChipLabel("x".repeat(512))).toBe("Pasted text (0.5 KB)");
  });
});
