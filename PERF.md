# Performance budgets & measurements

Budgets target a **low-end 4GB-RAM Mac** — the Zed/Sublime "feels instant" bar,
honest for a WebView app. Measured column: **signed release build
(0.0.1-alpha.6, universal) on the dev machine (Apple Silicon), real 1,263-note
iCloud vault**, 2026-07-02. Low-end hardware validation is still open (#70).

| # | Metric | Budget (4GB) | Measured | How to re-measure |
|---|---|---|---|---|
| 1 | Cold launch → editor interactive | ≤ 1.5s (warm ≤ 500ms) | **218ms** warm, ~314ms cool (bootperf: entry 73 → shell 99 → hydrated 102 → doc 203 → editor 218) | `bootperf` lines in app-data `logs/errors.log` |
| 2 | Keystroke → paint | p50 ≤ 8ms, p95 ≤ 16.7ms | **p50 0.21–0.31ms, p95 ≤ 0.46ms**, flat 313B → 1MB (model+decoration slice; jsdom, no paint) | `pnpm bench:baseline` → `docs/benchmarks/typing-latency.json` |
| 3 | Open/switch tab (100KB note) | ≤ 100ms | **42–52ms** (debug build, real paint; release is leaner). Throttled worst-case below. | `COMPOSE_PERF=1` build → `[perf] tab-switch` console lines (marks already wired in PaneTabs/ActiveDocument) |
| 4 | Vault walk (1k notes) | ≤ 300ms | **7.8ms** (1,000 notes / 50 dirs) | `cargo test walks_a_thousand_note_vault -- --nocapture` |
| 5 | External change → tree | ≤ 300ms | ~1s observed end-to-end incl. FSEvents latency; tree patch itself O(entry) | live: create/rm a note, watch the tree |
| 6 | Search query (1k notes) | ≤ 100ms | **1.1–1.7ms** release (common/rare/phrase; snapshot build 719ms, idle-deferred) | `cargo test -p workspace-index --release --test search_bench -- --nocapture` |
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

## Heap-snapshot session (tab-switch growth attribution)

`console.takeHeapSnapshot` before/after identical 10-switch rounds (each
snapshot forces a full GC; live-size read after later rounds decay it):

- **Quantified:** ~+0.5MB live JS heap per identical 10-switch round after the
  first-visit cache fill (~50KB/switch retained). Growing classes: plain
  `Object` (+~128/switch) and `string` (+~180/switch); `Function`/`Array`
  flat; the large `zc` class (3,289 instances) is constant — not a leak.
- **Static baseline attributed:** the biggest strings are **persisted agent
  traces** — harness Read-tool output (`N\t<line>` dumps of context files,
  ~9.5KB × several copies) hydrated with the conversation at boot. Weight, not
  growth; a trace-size cap/lazy-hydration is a possible future trim.
- **One unbounded structure found and fixed:** `navHistory` grew one entry per
  tab switch forever — now capped at `NAV_HISTORY_LIMIT` (100), oldest dropped.
- **Residual attribution** (which code owns the remaining small-object growth):
  export two snapshots from the Inspector's Snapshot List (Export button) and
  diff offline — the in-UI comparison doesn't isolate deltas well.

## CPU-throttled pass (low-end latency proxy)

`taskpolicy -b -p` on compose + WebContent + GPU pins everything to efficiency
cores with background IO/scheduling priority — harsher than an old machine's
P-cores, and on the DEBUG build (2× overhead), so a double-worst case:

- Tab switch: **212–461ms, median ~390ms** (vs 42–52ms unthrottled debug).
  Estimated real low-end (release + old hardware): **~150–250ms** — above the
  100ms budget, comfortably usable, and the clearest optimization target this
  suite has produced.
- Boot can't be fairly throttled this way: WKWebView helpers spawn via launchd
  and can't inherit the QoS before they start. A real 4GB VM remains the
  honest boot-latency check.

## Memory-pressure simulation (4GB-machine proxy)

`memory_pressure -p 12 -y 1800` squeezes the 32GB dev machine until ~12% is
free, and the app's own boot then pushed the system to **critical** pressure
(`kern.memorystatus_vm_pressure_level` 4 — jetsam territory). Under that:

- **Cold boot completed fully** — tree (1,263 notes), restored tabs, chat, and
  editor all rendered; the process was not jetsam'd.
- **Footprint stayed put:** 222MB total at critical vs 219MB unpressured — the
  app doesn't balloon under pressure.
- **Tab churn stayed responsive** — 10 switches, every click landed.

Caveat: RAM starvation doesn't slow the CPU, so this validates memory
*behavior* (pressure survival, no ballooning), not old-hardware latency.
A CPU-throttled pass (`taskpolicy -c background`, E-cores only — note: WKWebView
helpers won't inherit the QoS) or a real 4GB VM (VMware Fusion / Tart) remains
the honest low-end latency check.

## Method notes

- Memory is **phys_footprint summed across compose + its WKWebView helpers**
  (WebContent/GPU/Networking) — the main process alone under-reports by ~3×.
- The typing benchmark measures the dispatch → decoration-recompute slice
  (jsdom has no layout); the budget leaves the paint slice as headroom. Its
  structural assertion is that keystroke cost stays **O(viewport)**: the 1MB
  row must not leave the 313B row.
- Baseline specs (`*.baseline.spec.ts`) are excluded from `pnpm test`; run
  them with `pnpm bench:baseline`. Reports land in `docs/benchmarks/*.json`.
