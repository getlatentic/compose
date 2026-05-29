/**
 * Sample-set statistics for the lag benchmark.
 *
 * Every operation the benchmark times produces an array of wall-clock
 * millisecond samples. This module reduces that array to the three
 * numbers the committed baseline reports — median, p95, mean — using a
 * single, documented percentile method so the report is reproducible
 * and comparable across runs.
 *
 * Pure and dependency-free: no timers, no I/O. That keeps it unit-
 * testable in the default `pnpm test` suite without running the (slow,
 * opt-in) benchmark itself.
 */

export interface SampleSummary {
  /** Number of samples the summary was computed from. */
  samples: number;
  medianMs: number;
  p95Ms: number;
  meanMs: number;
}

/**
 * Linear-interpolation percentile (the "R-7" method, also NumPy's
 * default). `quantile` is in `[0, 1]`. `sorted` must be ascending.
 *
 * Interpolating between ranks — rather than nearest-rank — keeps the
 * p95 of a small sample set (the burst operations sample only 5 times)
 * from snapping to the single max and over-reporting tail latency.
 */
export function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = quantile * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const fraction = rank - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

/** Round to two decimals — the precision the committed baseline uses. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Reduce a sample array to {median, p95, mean}, rounded to the report's
 * two-decimal precision. Does not mutate the input.
 */
export function summarize(samplesMs: readonly number[]): SampleSummary {
  if (samplesMs.length === 0) {
    return { samples: 0, medianMs: 0, p95Ms: 0, meanMs: 0 };
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    samples: sorted.length,
    medianMs: round2(percentile(sorted, 0.5)),
    p95Ms: round2(percentile(sorted, 0.95)),
    meanMs: round2(sum / sorted.length),
  };
}
