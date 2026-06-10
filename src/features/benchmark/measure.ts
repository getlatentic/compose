/**
 * Wall-clock measurement primitive.
 *
 * Every benchmark operation is a fixed closure over prepared state, timed
 * N times after a warmup pass. Warmup runs the same code untimed first so
 * JIT compilation is amortised out of the sampled region.
 */

import { performance } from "node:perf_hooks";

export interface MeasureOptions {
  warmup: number;
  samples: number;
}

/** Time `fn` `samples` times after `warmup` untimed runs. */
export function measure(fn: () => void, opts: MeasureOptions): number[] {
  for (let i = 0; i < opts.warmup; i += 1) fn();
  const out = new Array<number>(opts.samples);
  for (let i = 0; i < opts.samples; i += 1) {
    const start = performance.now();
    fn();
    out[i] = performance.now() - start;
  }
  return out;
}
