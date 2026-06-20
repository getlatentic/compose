/**
 * Map a raw harness/runtime failure to a short, friendly summary plus the raw
 * detail (kept for a Details disclosure). The composer shows the summary in a
 * compact banner; the verbose original — a CLI stderr dump, a localhost
 * "connection refused", a backend JSON blob — stays hidden until expanded.
 *
 * Pure (no IO, no harness lookup) so it's unit-testable in isolation. The
 * summary is a single line kept under ~60 chars; `detail` is the raw text
 * verbatim.
 */
export interface FriendlyHarnessError {
  summary: string;
  detail: string;
}

/** Recognized failure modes → a short, harness-named summary. A table (not a
 * chain) so a new case is one entry; matched against the lowercased raw text,
 * first hit wins. `summary` receives the harness's display name. */
const SUMMARY_RULES: Array<{
  match: (text: string) => boolean;
  summary: (harnessName: string) => string;
}> = [
  {
    match: (text) =>
      [
        "connection refused",
        "econnrefused",
        "failed to connect",
        "not reachable",
        "/api/tags",
        "os error 61",
      ].some((key) => text.includes(key)),
    summary: (name) => `${name} isn't running — start it, then retry.`,
  },
  {
    match: (text) =>
      [
        "api key",
        "api_key",
        "unauthorized",
        "401",
        "authentication",
        "not authenticated",
      ].some((key) => text.includes(key)),
    summary: (name) => `${name} needs an API key in Settings.`,
  },
];

export function friendlyHarnessError(raw: string, harnessName: string): FriendlyHarnessError {
  const detail = (raw ?? "").trim();
  const name = harnessName?.trim() || "Your assistant";
  const text = detail.toLowerCase();
  const rule = SUMMARY_RULES.find((entry) => entry.match(text));
  const summary = rule ? rule.summary(name) : `${name} ran into a problem.`;
  return { summary, detail };
}
