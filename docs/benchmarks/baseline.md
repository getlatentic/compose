# Editor lag baseline

Captured: `2026-06-10T06:10:16.559Z`
Machine: `darwin` / 10 CPUs

## Measurement caveats
- Comment-overlay numbers measure the real, shipping overlap-scan code: rangeOverlapsAny (naive, O(comments x visible lines)) versus CommentRangeIndex.anyOverlapping (O(visible lines x log comments)). No Canvas2D / graphics layer is involved — the harness runs DOM-less in Node.
- Coordinate conversion (positionMapperBuild / positionMapperLookup10k) exercises PositionMapper, the byte<->code-unit owner that the comment layer and search-result locating depend on. This is the hot loop the chunked binary search exists to keep flat as documents grow.
- All numbers are wall-clock from performance.now() on a single runner thread; no GC pauses are filtered. The bench config (vitest.bench.config.ts) pins a single fork with no file parallelism so measurements are not perturbed by concurrent work.

## Scenarios

### `small` — 10 lines, 313 B

| Operation | Samples | Median (ms) | p95 (ms) | Mean (ms) |
|---|---:|---:|---:|---:|
| `positionMapperBuild` | 20 | 0.02 | 0.02 | 0.01 |
| `positionMapperLookup10k` | 10 | 5.15 | 5.16 | 5.15 |
| `commentOverlay1` | 8 | 0.00 | 0.00 | 0.00 |
| `commentOverlay1_indexed` | 8 | 0.00 | 0.00 | 0.00 |
| `commentAnchorUpdate1` | 8 | 0.00 | 0.01 | 0.00 |
| `commentOverlay10` | 8 | 0.01 | 0.01 | 0.01 |
| `commentOverlay10_indexed` | 8 | 0.00 | 0.00 | 0.00 |
| `commentAnchorUpdate10` | 8 | 0.00 | 0.00 | 0.00 |
| `commentOverlay100` | 8 | 0.00 | 0.00 | 0.00 |
| `commentOverlay100_indexed` | 8 | 0.00 | 0.01 | 0.00 |
| `commentAnchorUpdate100` | 8 | 0.04 | 0.04 | 0.04 |
| `commentOverlay1000` | 8 | 0.01 | 0.02 | 0.01 |
| `commentOverlay1000_indexed` | 8 | 0.00 | 0.00 | 0.00 |
| `commentAnchorUpdate1000` | 8 | 0.09 | 0.12 | 0.10 |
| `commentCreate100` | 8 | 0.23 | 0.26 | 0.24 |
| `commentCreate1000` | 8 | 2.44 | 2.57 | 2.46 |

### `large` — 8,533 lines, 300.2 KB

| Operation | Samples | Median (ms) | p95 (ms) | Mean (ms) |
|---|---:|---:|---:|---:|
| `positionMapperBuild` | 20 | 0.83 | 0.84 | 0.83 |
| `positionMapperLookup10k` | 10 | 15.18 | 15.21 | 15.18 |
| `commentOverlay1` | 8 | 0.00 | 0.02 | 0.01 |
| `commentOverlay1_indexed` | 8 | 0.00 | 0.00 | 0.00 |
| `commentAnchorUpdate1` | 8 | 0.00 | 0.00 | 0.00 |
| `commentOverlay10` | 8 | 0.01 | 0.01 | 0.01 |
| `commentOverlay10_indexed` | 8 | 0.00 | 0.01 | 0.00 |
| `commentAnchorUpdate10` | 8 | 0.00 | 0.00 | 0.00 |
| `commentOverlay100` | 8 | 0.07 | 0.07 | 0.07 |
| `commentOverlay100_indexed` | 8 | 0.00 | 0.00 | 0.00 |
| `commentAnchorUpdate100` | 8 | 0.01 | 0.01 | 0.01 |
| `commentOverlay1000` | 8 | 0.18 | 0.19 | 0.18 |
| `commentOverlay1000_indexed` | 8 | 0.00 | 0.00 | 0.00 |
| `commentAnchorUpdate1000` | 8 | 0.07 | 0.08 | 0.07 |
| `commentCreate100` | 8 | 1.43 | 1.44 | 1.43 |
| `commentCreate1000` | 8 | 6.63 | 6.67 | 6.63 |

### `xlarge` — 14,104 lines, 500.0 KB

| Operation | Samples | Median (ms) | p95 (ms) | Mean (ms) |
|---|---:|---:|---:|---:|
| `positionMapperBuild` | 20 | 1.38 | 1.39 | 1.38 |
| `positionMapperLookup10k` | 10 | 15.21 | 15.24 | 15.21 |
| `commentOverlay1` | 8 | 0.00 | 0.00 | 0.00 |
| `commentOverlay1_indexed` | 8 | 0.00 | 0.00 | 0.00 |
| `commentAnchorUpdate1` | 8 | 0.00 | 0.00 | 0.00 |
| `commentOverlay10` | 8 | 0.00 | 0.00 | 0.00 |
| `commentOverlay10_indexed` | 8 | 0.00 | 0.00 | 0.00 |
| `commentAnchorUpdate10` | 8 | 0.00 | 0.00 | 0.00 |
| `commentOverlay100` | 8 | 0.01 | 0.01 | 0.01 |
| `commentOverlay100_indexed` | 8 | 0.00 | 0.00 | 0.00 |
| `commentAnchorUpdate100` | 8 | 0.01 | 0.01 | 0.01 |
| `commentOverlay1000` | 8 | 0.24 | 0.24 | 0.24 |
| `commentOverlay1000_indexed` | 8 | 0.00 | 0.00 | 0.00 |
| `commentAnchorUpdate1000` | 8 | 0.08 | 0.09 | 0.08 |
| `commentCreate100` | 8 | 1.97 | 1.97 | 1.97 |
| `commentCreate1000` | 8 | 7.22 | 7.40 | 7.25 |

_Re-run with `pnpm bench:baseline`. Compare post-change numbers against this file._
