import { describe, expect, it } from "vitest";

import { findIntendedModel, modelMatchesQuery, normalizeModelName } from "./modelMatching";

/**
 * Field report that produced this: typing `gpt-oss-120b` into OpenRouter's
 * model field was told the model "may no longer be available", while
 * `openai/gpt-oss-120b` sat in the list under the display name `GPT OSS 120B`.
 * Three names for one model, and the picker matched none of them to each other.
 */

const OPENROUTER: { value: string; label: string }[] = [
  { value: "openai/gpt-oss-120b", label: "GPT OSS 120B" },
  { value: "openai/gpt-oss-20b", label: "GPT OSS 20B" },
  { value: "openai/gpt-oss-20b:free", label: "gpt-oss-20b (free)" },
  { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
];

describe("normalizeModelName", () => {
  it("treats case and separators as noise", () => {
    expect(normalizeModelName("GPT OSS 120B")).toBe("gptoss120b");
    expect(normalizeModelName("gpt-oss-120b")).toBe("gptoss120b");
    expect(normalizeModelName("gpt_oss_120b")).toBe("gptoss120b");
  });

  it("keeps what actually distinguishes two models", () => {
    // 20b and 120b must never collapse into each other.
    expect(normalizeModelName("gpt-oss-20b")).not.toBe(normalizeModelName("gpt-oss-120b"));
  });
});

describe("filtering the dropdown", () => {
  it("finds a model by its id without the namespace", () => {
    // The reported case: nobody types the `openai/` prefix.
    const hits = OPENROUTER.filter((m) => modelMatchesQuery(m, "gpt-oss-120b"));
    expect(hits.map((m) => m.value)).toEqual(["openai/gpt-oss-120b"]);
  });

  it("finds a model by its display name", () => {
    const hits = OPENROUTER.filter((m) => modelMatchesQuery(m, "GPT OSS 120B"));
    expect(hits.map((m) => m.value)).toEqual(["openai/gpt-oss-120b"]);
  });

  it("finds a model by its full id", () => {
    const hits = OPENROUTER.filter((m) => modelMatchesQuery(m, "openai/gpt-oss-120b"));
    expect(hits.map((m) => m.value)).toEqual(["openai/gpt-oss-120b"]);
  });

  it("narrows as you type, and by vendor", () => {
    expect(OPENROUTER.filter((m) => modelMatchesQuery(m, "gpt")).length).toBe(3);
    expect(OPENROUTER.filter((m) => modelMatchesQuery(m, "anthropic")).length).toBe(1);
  });

  it("shows everything for an empty query", () => {
    expect(OPENROUTER.filter((m) => modelMatchesQuery(m, "")).length).toBe(OPENROUTER.length);
  });
});

describe("did you mean", () => {
  it("resolves the un-namespaced id the user typed", () => {
    expect(findIntendedModel(OPENROUTER, "gpt-oss-120b")?.value).toBe("openai/gpt-oss-120b");
  });

  it("resolves the display name", () => {
    expect(findIntendedModel(OPENROUTER, "GPT OSS 120B")?.value).toBe("openai/gpt-oss-120b");
  });

  it("resolves what macOS autocapitalisation produces", () => {
    // The exact string from the report.
    expect(findIntendedModel(OPENROUTER, "Gpt-oss-120b")?.value).toBe("openai/gpt-oss-120b");
  });

  it("prefers a full-id match over a suffix match", () => {
    // Two vendors serving the same model name must not be resolved by luck.
    const ambiguous = [
      { value: "vendor-a/mixtral", label: "Mixtral" },
      { value: "mixtral", label: "Mixtral (direct)" },
    ];
    expect(findIntendedModel(ambiguous, "mixtral")?.value).toBe("mixtral");
  });

  it("suggests nothing for a genuinely unknown model", () => {
    // The message this drives says "did you mean"; with no candidate it must
    // stay quiet rather than propose a wrong model.
    expect(findIntendedModel(OPENROUTER, "llama-3.1-405b")).toBeNull();
  });

  it("does not confuse 20b with 120b", () => {
    expect(findIntendedModel(OPENROUTER, "gpt-oss-20b")?.value).toBe("openai/gpt-oss-20b");
    expect(findIntendedModel(OPENROUTER, "gpt-oss-120b")?.value).toBe("openai/gpt-oss-120b");
  });

  it("suggests nothing for an empty field", () => {
    expect(findIntendedModel(OPENROUTER, "   ")).toBeNull();
  });
});
