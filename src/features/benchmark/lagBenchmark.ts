/**
 * Lag benchmark — the editor's perf gate.
 *
 * Captures the live, interactive hot paths users feel, at several
 * document sizes, and reduces each to median / p95 / mean wall-clock.
 * The committed report lives at `docs/benchmarks/baseline.json`
 * (+ `baseline.md`); regenerate with `pnpm bench:baseline` and diff.
 *
 * This module is the orchestrator referenced from `CLAUDE.md` and
 * `docs/editor-guide.md`. It owns no measurement logic itself — it
 * composes the text-pipeline (coordinate conversion) and comment
 * operations into one report per scenario. Add an operation by editing
 * the relevant `*Operations` module; add a document size in
 * `documentFixtures`.
 *
 * It runs DOM-less in Node (no Canvas, no React, no WASM): the numbers
 * characterise the `PositionMapper` coordinate hot loop and the comment
 * overlap-scan algorithm — the TypeScript that runs on the input thread.
 */

import type { BenchmarkDocument } from "./documentFixtures";
import { commentOperationRunners } from "./commentOperations";
import { textOperationRunners } from "./textOperations";
import type { OperationResult } from "./operationResult";

export interface ScenarioReport {
  scenario: string;
  documentLineCount: number;
  documentByteSize: number;
  operations: OperationResult[];
}

export interface MachineInfo {
  platform: string;
  cpuCount: number;
}

export interface BenchmarkReport {
  capturedAt: string;
  machine: MachineInfo;
  measurementCaveats: readonly string[];
  scenarios: ScenarioReport[];
}

/** What this benchmark does and does not measure — kept with the data. */
export const MEASUREMENT_CAVEATS: readonly string[] = [
  "Comment-overlay numbers measure the real, shipping overlap-scan code: rangeOverlapsAny (naive, " +
    "O(comments x visible lines)) versus CommentRangeIndex.anyOverlapping (O(visible lines x log " +
    "comments)). No Canvas2D / graphics layer is involved — the harness runs DOM-less in Node.",
  "Coordinate conversion (positionMapperBuild / positionMapperLookup10k) exercises PositionMapper, " +
    "the byte<->code-unit owner that the comment layer and search-result locating depend on. This " +
    "is the hot loop the chunked binary search exists to keep flat as documents grow.",
  "All numbers are wall-clock from performance.now() on a single runner thread; no GC pauses are " +
    "filtered. The bench config (vitest.bench.config.ts) pins a single fork with no file " +
    "parallelism so measurements are not perturbed by concurrent work.",
];

/** Yield to the event loop so vitest's worker can flush its RPC heartbeat. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Run every scenario and return the scenario rows. The caller stamps
 * environment metadata (capturedAt, machine) — kept out of here so the
 * orchestrator stays deterministic and unit-friendly.
 *
 * Async by necessity, not by nature: each operation is a synchronous
 * measurement, but we `await` a yield between operations so a single
 * uninterrupted block stays short and never starves vitest's worker RPC.
 */
export async function runLagBenchmark(
  documents: readonly BenchmarkDocument[],
): Promise<{ scenarios: ScenarioReport[] }> {
  const scenarios: ScenarioReport[] = [];
  for (const doc of documents) {
    const runners = [...textOperationRunners(doc), ...commentOperationRunners(doc)];
    const operations: OperationResult[] = [];
    for (const run of runners) {
      operations.push(run());
      await yieldToEventLoop();
    }
    scenarios.push({
      scenario: doc.label,
      documentLineCount: doc.lineCount,
      documentByteSize: doc.byteSize,
      operations,
    });
  }
  return { scenarios };
}
