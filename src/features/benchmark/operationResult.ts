/**
 * The per-operation row shape in the committed baseline, plus the
 * constructor that turns a raw sample array into it.
 *
 * Kept separate from both `statistics` (which knows nothing about the
 * report shape) and `lagBenchmark` (the orchestrator) so the operation
 * modules can depend on it without a cycle through the orchestrator.
 */

import { summarize, type SampleSummary } from "./statistics";

export interface OperationResult extends SampleSummary {
  /** Stable identifier, e.g. `commentOverlay1000_indexed`, `positionMapperLookup10k`. */
  name: string;
}

/** Summarise a flat sample array into an operation row. */
export function makeResult(name: string, samplesMs: readonly number[]): OperationResult {
  return { name, ...summarize(samplesMs) };
}
