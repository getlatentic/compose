# Performance budgets & measurements

Budgets target a **low-end 4GB-RAM Mac** — the Zed/Sublime "feels instant" bar,
honest for a WebView app. Measured column: **signed release build
(0.0.1-alpha.6, universal) on the dev machine (Apple Silicon), real 1,263-note
iCloud vault**, 2026-07-02. Low-end hardware validation is still open (#70).

| # | Metric | Budget (4GB) | Measured | How to re-measure |
|---|---|---|---|---|
| 1 | Cold launch → editor interactive | ≤ 1.5s (warm ≤ 500ms) | **218ms** warm, ~314ms cool (bootperf: entry 73 → shell 99 → hydrated 102 → doc 203 → editor 218) | `bootperf` lines in app-data `logs/errors.log` |
| 2 | Keystroke → paint | p50 ≤ 8ms, p95 ≤ 16.7ms | **p50 0.21–0.31ms, p95 ≤ 0.46ms**, flat 313B → 1MB (model+decoration slice; jsdom, no paint) | `pnpm bench:baseline` → `docs/benchmarks/typing-latency.json` |
| 3 | Open/switch tab (100KB note) | ≤ 100ms | ~100ms at boot (`doc @ 203ms` minus shell); per-open not yet isolated | — (open) |
| 4 | Vault walk (1k notes) | ≤ 300ms | **7.8ms** (1,000 notes / 50 dirs) | `cargo test walks_a_thousand_note_vault -- --nocapture` |
| 5 | External change → tree | ≤ 300ms | ~1s observed end-to-end incl. FSEvents latency; tree patch itself O(entry) | live: create/rm a note, watch the tree |
| 6 | Search query (1k notes) | ≤ 100ms | not yet measured | — (open) |
| 7 | Memory, 1k-note vault open | ≤ 400MB total | **219MB** total (main 71 + WebContent 125 + GPU 17 + Networking 6) | `scripts/measure-memory.sh <label>` |
| 8 | UI while chat streams | 60fps sustained | rAF-batched by design; not yet instrumented | — (open) |

## Leak status (alpha-6 session, signed build)

- **Idle soak (3 min):** flat — 219 → 218MB. No timer/interval accumulation.
- **fs churn (100 external create/delete cycles = 200 watcher events):** zero
  growth (218 → 218MB). The incremental tree-patch path (#68) is
  allocation-clean.
- **Native leaks:** `leaks <pid>` on the Rust process: **0 leaked bytes**
  (109,760 nodes / 25MB malloc'd).
- **Watch item — tab-switch slack:** cycling the same 5 notes grows WebContent
  ~+31MB on first visit (per-tab editor-state cache, expected), then
  **~+0.7MB per switch** on repeat visits (+7MB per 10 switches; rounds:
  +31, +7, +7). Main process memory *falls* over the same period (71 → 58MB),
  so it's WebContent-side only: either WebKit GC slack (lazy, no memory
  pressure) or a small per-switch retention. **Next step:** heap-snapshot diff
  in the debug build's devtools across one switch cycle to attribute it.
  Not user-visible at current magnitudes (hours of constant switching ≈ tens
  of MB, and macOS applies memory pressure long before it matters).

## Method notes

- Memory is **phys_footprint summed across compose + its WKWebView helpers**
  (WebContent/GPU/Networking) — the main process alone under-reports by ~3×.
- The typing benchmark measures the dispatch → decoration-recompute slice
  (jsdom has no layout); the budget leaves the paint slice as headroom. Its
  structural assertion is that keystroke cost stays **O(viewport)**: the 1MB
  row must not leave the 313B row.
- Baseline specs (`*.baseline.spec.ts`) are excluded from `pnpm test`; run
  them with `pnpm bench:baseline`. Reports land in `docs/benchmarks/*.json`.
