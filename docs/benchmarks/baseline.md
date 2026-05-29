# Editor lag baseline

Captured: `2026-05-29T08:06:07.182Z`
Machine: `darwin` / 10 CPUs

## Measurement caveats
- Comment-overlay numbers measure the real, shipping overlap-scan code: rangeOverlapsAny (naive, O(comments x visible lines)) versus CommentRangeIndex.anyOverlapping (O(visible lines x log comments)). No Canvas2D / graphics layer is involved — the harness runs DOM-less in Node.
- Coordinate conversion (positionMapperBuild / positionMapperLookup10k) exercises PositionMapper, the byte<->code-unit owner that the comment layer and search-result locating depend on. This is the hot loop the chunked binary search exists to keep flat as documents grow.
- All numbers are wall-clock from performance.now() on a single runner thread; no GC pauses are filtered. The bench config (vitest.bench.config.ts) pins a single fork with no file parallelism so measurements are not perturbed by concurrent work.

## Scenarios

### `small` — 10 lines, 313 B

| Operation | Samples | Median (ms) | p95 (ms) | Mean (ms) |
|---|---:|---:|---:|---:|
| `positionMapperBuild` | 20 | 0.03 | 0.05 | 0.03 |
| `positionMapperLookup10k` | 10 | 13.29 | 14.66 | 13.38 |
| `commentOverlay1` | 8 | 0.01 | 0.01 | 0.01 |
| `commentOverlay1_indexed` | 8 | 0.01 | 0.01 | 0.01 |
| `commentAnchorUpdate1` | 8 | 0.01 | 0.13 | 0.03 |
| `commentOverlay10` | 8 | 0.01 | 0.59 | 0.12 |
| `commentOverlay10_indexed` | 8 | 0.00 | 0.00 | 0.00 |
| `commentAnchorUpdate10` | 8 | 0.01 | 0.01 | 0.01 |
| `commentOverlay100` | 8 | 0.02 | 0.15 | 0.04 |
| `commentOverlay100_indexed` | 8 | 0.01 | 0.01 | 0.01 |
| `commentAnchorUpdate100` | 8 | 0.12 | 0.13 | 0.11 |
| `commentOverlay1000` | 8 | 0.08 | 0.08 | 0.08 |
| `commentOverlay1000_indexed` | 8 | 0.01 | 0.01 | 0.01 |
| `commentAnchorUpdate1000` | 8 | 0.50 | 0.62 | 0.52 |
| `commentCreate100` | 8 | 0.69 | 1.20 | 0.79 |
| `commentCreate1000` | 8 | 6.32 | 7.76 | 6.64 |

### `large` — 8,533 lines, 300.2 KB

| Operation | Samples | Median (ms) | p95 (ms) | Mean (ms) |
|---|---:|---:|---:|---:|
| `positionMapperBuild` | 20 | 2.16 | 3.21 | 2.34 |
| `positionMapperLookup10k` | 10 | 63.81 | 193.94 | 94.36 |
| `commentOverlay1` | 8 | 0.01 | 0.01 | 0.01 |
| `commentOverlay1_indexed` | 8 | 0.01 | 0.02 | 0.01 |
| `commentAnchorUpdate1` | 8 | 0.00 | 0.00 | 0.00 |
| `commentOverlay10` | 8 | 0.01 | 0.02 | 0.01 |
| `commentOverlay10_indexed` | 8 | 0.06 | 0.17 | 0.08 |
| `commentAnchorUpdate10` | 8 | 0.00 | 0.03 | 0.01 |
| `commentOverlay100` | 8 | 0.04 | 0.06 | 0.04 |
| `commentOverlay100_indexed` | 8 | 0.01 | 0.01 | 0.01 |
| `commentAnchorUpdate100` | 8 | 0.02 | 0.06 | 0.03 |
| `commentOverlay1000` | 8 | 0.59 | 0.59 | 0.59 |
| `commentOverlay1000_indexed` | 8 | 0.01 | 0.01 | 0.01 |
| `commentAnchorUpdate1000` | 8 | 0.22 | 0.25 | 0.22 |
| `commentCreate100` | 8 | 3.78 | 4.32 | 3.90 |
| `commentCreate1000` | 8 | 18.54 | 19.64 | 18.38 |

### `xlarge` — 14,104 lines, 500.0 KB

| Operation | Samples | Median (ms) | p95 (ms) | Mean (ms) |
|---|---:|---:|---:|---:|
| `positionMapperBuild` | 20 | 3.67 | 4.31 | 3.78 |
| `positionMapperLookup10k` | 10 | 43.15 | 45.60 | 43.32 |
| `commentOverlay1` | 8 | 0.01 | 0.01 | 0.01 |
| `commentOverlay1_indexed` | 8 | 0.01 | 0.01 | 0.01 |
| `commentAnchorUpdate1` | 8 | 0.00 | 0.00 | 0.00 |
| `commentOverlay10` | 8 | 0.01 | 0.01 | 0.01 |
| `commentOverlay10_indexed` | 8 | 0.01 | 0.01 | 0.01 |
| `commentAnchorUpdate10` | 8 | 0.00 | 0.01 | 0.00 |
| `commentOverlay100` | 8 | 0.04 | 0.07 | 0.05 |
| `commentOverlay100_indexed` | 8 | 0.01 | 0.03 | 0.01 |
| `commentAnchorUpdate100` | 8 | 0.02 | 0.02 | 0.02 |
| `commentOverlay1000` | 8 | 0.59 | 0.72 | 0.62 |
| `commentOverlay1000_indexed` | 8 | 0.00 | 0.00 | 0.00 |
| `commentAnchorUpdate1000` | 8 | 0.21 | 0.26 | 0.21 |
| `commentCreate100` | 8 | 5.22 | 5.39 | 5.20 |
| `commentCreate1000` | 8 | 19.72 | 20.49 | 19.60 |

_Re-run with `pnpm bench:baseline`. Compare post-change numbers against this file._
