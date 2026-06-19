/**
 * Turn a raw harness/runtime failure into one short, human line for the chat.
 *
 * Harnesses surface errors as anything from a backend JSON blob (a Codex 400)
 * to a CLI stderr dump. Shown verbatim that's noise, so we pull the human
 * message out of the common shapes, map a few recognizable failure modes to
 * plain guidance, and cap the length. The raw text is still logged for
 * diagnostics (the call sites pass it to `reportClientError`).
 */
export function formatHarnessError(raw: string): string {
  const text = (raw ?? "").trim();
  if (!text) {
    return "Something went wrong. Please try again.";
  }
  const message = extractMessage(text);
  return knownFailure(message) ?? truncate(capitalizeFirst(stripUrls(message)), MAX_LEN);
}

const MAX_LEN = 220;

/** Recognizable failure modes mapped to plain, actionable guidance. A table,
 * not a chain, so new cases are one entry. Matched against the lowercased
 * message, first hit wins. */
const KNOWN_FAILURES: Array<{ match: (text: string) => boolean; message: string }> = [
  {
    match: (text) => text.includes("reasoning.effort") && text.includes("minimal"),
    message:
      "That model and reasoning-effort combination isn't supported. Try a different model or effort.",
  },
  {
    match: (text) => text.includes("not supported") && text.includes("chatgpt"),
    message:
      "That model isn't available on your Codex (ChatGPT) plan. Pick a different model in the footer.",
  },
  {
    match: (text) =>
      text.includes("rate limit") || text.includes("429") || text.includes("quota"),
    message: "You've hit the rate limit. Wait a moment, then try again.",
  },
  {
    match: (text) =>
      ["unauthorized", "401", "authentication", "invalid api key", "invalid_api_key"].some((key) =>
        text.includes(key),
      ),
    message: "Your assistant couldn't authenticate. Check its API key or sign-in in Settings.",
  },
  {
    match: (text) => text.includes("database is locked"),
    message: "Compose was busy saving. Please try again.",
  },
  {
    match: (text) => text.includes("timed out") || text.includes("timeout"),
    message: "The assistant timed out. Please try again.",
  },
  {
    match: (text) =>
      ["connection refused", "econnrefused", "failed to connect"].some((key) => text.includes(key)),
    message: "Couldn't reach the assistant. Make sure it's running, then try again.",
  },
  {
    match: (text) =>
      ["command not found", "enoent", "no such file"].some((key) => text.includes(key)),
    message: "The assistant's program wasn't found. Re-install it in Settings.",
  },
  {
    match: (text) => /status code 4\d\d|status 4\d\d|http 4\d\d|error 4\d\d/.test(text),
    message: "The assistant rejected the request. Try a different model, or check the model in the footer.",
  },
  {
    match: (text) => /status code 5\d\d|status 5\d\d|http 5\d\d|error 5\d\d/.test(text),
    message: "The assistant's service hit an error. Wait a moment, then try again.",
  },
];

function knownFailure(message: string): string | null {
  const text = message.toLowerCase();
  return KNOWN_FAILURES.find((entry) => entry.match(text))?.message ?? null;
}

/** Pull the human-readable message out of a JSON error blob, whether the whole
 * string is JSON or JSON is embedded after a prefix ("stream error: {…}").
 * Falls back to the original text when there's nothing to mine. */
function extractMessage(text: string): string {
  const brace = text.indexOf("{");
  const json = parseJsonObject(text) ?? (brace > 0 ? parseJsonObject(text.slice(brace)) : null);
  if (!json) {
    return text;
  }
  const error = json.error;
  const nested =
    typeof error === "object" && error !== null
      ? asString((error as Record<string, unknown>).message)
      : null;
  return nested ?? asString(error) ?? asString(json.message) ?? asString(json.detail) ?? text;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.startsWith("{")) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Drop raw URLs from a fallback message — a localhost endpoint or model URL is
 * noise to the reader (the known-failure table handles the meaningful cases). */
function stripUrls(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
