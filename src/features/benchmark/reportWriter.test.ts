import { describe, expect, it } from "vitest";
import type { BenchmarkReport } from "./lagBenchmark";
import { toBaselineJson, toBaselineMarkdown } from "./reportWriter";

const REPORT: BenchmarkReport = {
  capturedAt: "2026-05-29T00:00:00.000Z",
  machine: { platform: "darwin", cpuCount: 10 },
  measurementCaveats: ["caveat one", "caveat two"],
  scenarios: [
    {
      scenario: "large",
      documentLineCount: 10802,
      documentByteSize: 299298,
      operations: [
        { name: "positionMapperLookup10k", samples: 10, medianMs: 16.74, p95Ms: 16.98, meanMs: 16.74 },
        { name: "commentOverlay1000", samples: 8, medianMs: 0.27, p95Ms: 0.29, meanMs: 0.28 },
      ],
    },
  ],
};

describe("toBaselineJson", () => {
  it("round-trips to the same report object", () => {
    expect(JSON.parse(toBaselineJson(REPORT))).toEqual(REPORT);
  });

  it("ends with a trailing newline", () => {
    expect(toBaselineJson(REPORT).endsWith("}\n")).toBe(true);
  });
});

describe("toBaselineMarkdown", () => {
  const md = toBaselineMarkdown(REPORT);

  it("renders the header metadata", () => {
    expect(md).toContain("Machine: `darwin` / 10 CPUs");
    expect(md).toContain("Captured: `2026-05-29T00:00:00.000Z`");
  });

  it("lists every caveat", () => {
    expect(md).toContain("- caveat one");
    expect(md).toContain("- caveat two");
  });

  it("humanizes byte sizes and groups line counts", () => {
    expect(md).toContain("`large` — 10,802 lines, 292.3 KB");
  });

  it("renders an operation row", () => {
    expect(md).toContain("| `positionMapperLookup10k` | 10 | 16.74 | 16.98 | 16.74 |");
    expect(md).toContain("| `commentOverlay1000` | 8 | 0.27 | 0.29 | 0.28 |");
  });

  it("includes the re-run footer", () => {
    expect(md).toContain("pnpm bench:baseline");
  });
});
