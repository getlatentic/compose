import { describe, expect, it } from "vitest";

import { friendlyHarnessError } from "./harnessErrorMessage";

describe("friendlyHarnessError", () => {
  it("maps a connection-refused / not-reachable failure to a start-it summary", () => {
    const raw =
      "Ollama is not reachable at http://localhost:11434 … Connect error: Connection refused (os error 61)";
    const { summary, detail } = friendlyHarnessError(raw, "Ollama");
    expect(summary).toBe("Ollama isn't running — start it, then retry.");
    expect(summary.length).toBeLessThan(60);
    // The raw text is preserved verbatim for the Details disclosure.
    expect(detail).toBe(raw);
  });

  it("recognizes an /api/tags probe failure", () => {
    const { summary } = friendlyHarnessError("GET /api/tags failed", "Ollama");
    expect(summary).toBe("Ollama isn't running — start it, then retry.");
  });

  it("maps a missing/invalid API key to a Settings summary", () => {
    const { summary } = friendlyHarnessError("401 Unauthorized: invalid api key", "Codex");
    expect(summary).toBe("Codex needs an API key in Settings.");
    expect(summary.length).toBeLessThan(60);
  });

  it("falls back to a generic short summary for an unrecognized failure", () => {
    const raw = "panic: something exploded deep in the runtime";
    const { summary, detail } = friendlyHarnessError(raw, "Claude");
    expect(summary).toBe("Claude ran into a problem.");
    expect(detail).toBe(raw);
  });

  it("uses a neutral name when none is given", () => {
    expect(friendlyHarnessError("boom", "").summary).toBe("Your assistant ran into a problem.");
  });
});
