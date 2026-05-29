/**
 * Lag benchmark capture entry.
 *
 * Excluded from `pnpm test` (filename ends in `.baseline.spec.ts`; see
 * vite.config.ts) and run explicitly via `pnpm bench:baseline`, which
 * points vitest at `vitest.bench.config.ts` (serial, long timeout). It
 * runs the full benchmark, writes `docs/benchmarks/baseline.{json,md}`,
 * and asserts coarse sanity gates — never tight wall-clock thresholds,
 * which belong nowhere in a test suite.
 */

import * as os from "node:os";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildDocument, DOCUMENT_SIZE_LABELS } from "./documentFixtures";
import { MEASUREMENT_CAVEATS, runLagBenchmark, type BenchmarkReport } from "./lagBenchmark";
import { toBaselineJson, toBaselineMarkdown } from "./reportWriter";

const JSON_PATH = fileURLToPath(new URL("../../../docs/benchmarks/baseline.json", import.meta.url));
const MD_PATH = fileURLToPath(new URL("../../../docs/benchmarks/baseline.md", import.meta.url));

describe("editor lag baseline", () => {
  it("captures the baseline and writes the committed report", async () => {
    const documents = DOCUMENT_SIZE_LABELS.map(buildDocument);
    const { scenarios } = await runLagBenchmark(documents);

    const report: BenchmarkReport = {
      capturedAt: new Date().toISOString(),
      machine: { platform: os.platform(), cpuCount: os.cpus().length },
      measurementCaveats: MEASUREMENT_CAVEATS,
      scenarios,
    };

    // --- Sanity gates (structural / algorithmic, never tight timings) ---
    expect(scenarios.map((s) => s.scenario)).toEqual([...DOCUMENT_SIZE_LABELS]);

    for (const scenario of scenarios) {
      expect(scenario.operations.length).toBeGreaterThan(0);
      for (const op of scenario.operations) {
        expect(Number.isFinite(op.medianMs), `${op.name} median finite`).toBe(true);
        expect(op.medianMs).toBeGreaterThanOrEqual(0);
        expect(op.p95Ms + 1e-9).toBeGreaterThanOrEqual(op.medianMs);
      }
    }

    // The index must not be slower than the naive scan at 1000 comments
    // on the largest document — the whole reason CommentRangeIndex exists.
    // Generous epsilon: this is a correctness-of-algorithm gate, not a
    // latency budget.
    const largest = scenarios[scenarios.length - 1];
    const naive = operation(largest, "commentOverlay1000");
    const indexed = operation(largest, "commentOverlay1000_indexed");
    expect(indexed.medianMs).toBeLessThanOrEqual(naive.medianMs + 0.5);

    writeFileSync(JSON_PATH, toBaselineJson(report));
    writeFileSync(MD_PATH, toBaselineMarkdown(report));
  });
});

function operation(scenario: { operations: { name: string; medianMs: number }[] }, name: string) {
  const op = scenario.operations.find((candidate) => candidate.name === name);
  if (!op) throw new Error(`operation ${name} missing from scenario`);
  return op;
}
