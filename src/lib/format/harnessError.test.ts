import { describe, expect, it } from "vitest";
import { formatHarnessError } from "./harnessError";

describe("formatHarnessError", () => {
  it("falls back for empty input", () => {
    expect(formatHarnessError("")).toBe("Something went wrong. Please try again.");
    expect(formatHarnessError("   ")).toBe("Something went wrong. Please try again.");
  });

  it("pulls the message out of a JSON error blob", () => {
    const raw = '{"type":"invalid_request_error","message":"Something specific went wrong","status":400}';
    expect(formatHarnessError(raw)).toBe("Something specific went wrong");
  });

  it("pulls a nested error.message", () => {
    const raw = '{"error":{"message":"nested detail","code":"bad"}}';
    expect(formatHarnessError(raw)).toBe("Nested detail");
  });

  it("mines JSON embedded after a prefix", () => {
    const raw = 'stream error: {"message":"deep failure"}';
    expect(formatHarnessError(raw)).toBe("Deep failure");
  });

  it("maps the codex minimal-effort 400 to guidance", () => {
    const raw =
      '{"type":"invalid_request_error","message":"The following tools cannot be used with reasoning.effort \'minimal\': image_gen, web_search.","status":400}';
    expect(formatHarnessError(raw)).toContain("reasoning-effort");
  });

  it("maps the ChatGPT-plan model rejection to guidance", () => {
    expect(formatHarnessError("gpt-4o is not supported when using Codex with a ChatGPT account")).toContain(
      "Codex (ChatGPT) plan",
    );
  });

  it("maps auth + rate-limit failures", () => {
    expect(formatHarnessError("401 Unauthorized")).toContain("authenticate");
    expect(formatHarnessError("Error: rate limit exceeded")).toContain("rate limit");
  });

  it("passes through a plain message, capitalized", () => {
    expect(formatHarnessError("the model is offline")).toBe("The model is offline");
  });

  it("truncates very long messages", () => {
    const long = `${"x".repeat(400)}`;
    const out = formatHarnessError(long);
    expect(out.length).toBeLessThanOrEqual(220);
    expect(out.endsWith("…")).toBe(true);
  });

  it("maps a generic HTTP 400 to plain guidance, no URLs", () => {
    const raw =
      "Chat request to http://localhost:11434/v1/chat/completions failed: http://localhost:11434/v1/chat/completions: status code 400";
    const out = formatHarnessError(raw);
    expect(out).toContain("rejected the request");
    expect(out).not.toContain("http");
  });

  it("strips URLs from an unrecognized fallback message", () => {
    expect(formatHarnessError("weird failure at https://example.com/x")).not.toContain("http");
  });
});
