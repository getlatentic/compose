/**
 * Text-pipeline operations for the lag baseline.
 *
 * Coordinate conversion (`PositionMapper`) is the editor-guide's
 * single most perf-critical primitive: it runs per render, per edit
 * batch, per comment anchor. Two costs matter and are tracked here:
 *
 *   * `positionMapperBuild` — the O(n) chunk-index construction paid
 *     once per document snapshot; and
 *   * `positionMapperLookup10k` — 10,000 byte→code-unit lookups on a
 *     warm mapper, the hot-loop cost the chunked binary search exists
 *     to keep flat. This is the microbenchmark that previously lived as
 *     a wall-clock assertion in `positionMapper.test.ts`; its gate now
 *     lives here, where a loaded machine can't turn it into a flake.
 *
 * Lookups are spread deterministically (a multiplicative hash, no RNG)
 * so the numbers are reproducible run to run.
 */

import { PositionMapper } from "../text/positionMapper";
import type { BenchmarkDocument } from "./documentFixtures";
import { measure } from "./measure";
import { makeResult, type OperationResult } from "./operationResult";

const LOOKUPS = 10_000;
/** Knuth multiplicative constant — spreads indices evenly without RNG. */
const HASH = 2654435761;

export function textOperationRunners(doc: BenchmarkDocument): Array<() => OperationResult> {
  return [() => positionMapperBuild(doc), () => positionMapperLookup10k(doc)];
}

/** O(n) chunk-index construction over the document snapshot. */
function positionMapperBuild(doc: BenchmarkDocument): OperationResult {
  let sink = 0;
  const samples = measure(
    () => {
      // Read a field so the constructor can't be optimised away.
      sink += new PositionMapper(doc.text).byteLength;
    },
    { warmup: 3, samples: 20 },
  );
  if (sink <= 0) throw new Error("position mapper build produced no work");
  return makeResult("positionMapperBuild", samples);
}

/** 10k warm byte→code-unit lookups — the coordinate hot loop. */
function positionMapperLookup10k(doc: BenchmarkDocument): OperationResult {
  const mapper = new PositionMapper(doc.text);
  const span = mapper.byteLength + 1;
  let sink = 0;
  const samples = measure(
    () => {
      for (let i = 0; i < LOOKUPS; i += 1) {
        sink += mapper.byteToCodeUnit((i * HASH) % span);
      }
    },
    { warmup: 2, samples: 10 },
  );
  if (sink <= 0) throw new Error("position mapper lookups produced no work");
  return makeResult("positionMapperLookup10k", samples);
}
