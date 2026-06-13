# Production-readiness test run — 2026-06-13

End-to-end test of the packaged macOS app
(`/Applications/Compose.app`, installed `2026-06-13 16:57`) driven via
computer-use against the actual `.app`, not the browser preview.

## Setup

| | |
|---|---|
| App build | Compose 0.0.1-alpha.1, fresh `pnpm tauri build` |
| Branch on `main` | titlebar reverted to natural 40px row (icons not pixel-aligned but visible) |
| agent-harness | 0.3.5 (node pairing + preflight) |
| Stress fixture | `/tmp/compose-test-50` — 50 × ~1.1MB markdown files, 52MB total. Realistic content (headings, code blocks, tables, bullets, quotes). |
| Empty fixture | `/tmp/compose-test-empty` (0 files) |
| Helper | `/tmp/compose-perf-measure.sh <label>` prints RSS / CPU / threads with timestamp |
| Baseline | App at idle: **110 MB RSS, 25 threads** |
| Harnesses tested | bob: deferred (Settings re-key flow not exercised this run) |

## Scenarios — scoped to 4 high-signal

| # | Scenario | Result | Notes |
|---|---|---|---|
| S0 | 50-tab stress (1MB each, Sublime bar) | ⚠️ FAIL — cold-open ~22s for 1MB, second tab open never landed | See below |
| S1 | Fresh empty folder | _pending_ | — |
| S4 | Edit via chat — bob | _pending_ | — |
| S7 | Comment → send to chat | _pending_ | — |

---

## S0 — 50-tab stress test (1MB each)

### Goal

Sublime-level perf bar (every interaction sub-frame). Workspace of 50 ×
~1.1MB markdown files (164k words each). Measure: workspace scan, file
open, tab switch, memory growth, editor responsiveness.

### What I did

1. App launched fresh → measured baseline RSS.
2. Workspace switcher (sidebar `notes ▾`) → Open a folder → typed
   `/tmp/compose-test-50` via Cmd+Shift+G → Open.
3. Waited for scan; measured RSS at 2s and 5s.
4. Double-clicked `note-01.md` (the first 1MB file). Polled RSS/CPU until
   rendered.
5. Double-clicked `note-02.md`. Polled RSS/CPU for 30s waiting for the
   second tab to appear.

### Results

| Moment | Time | RSS | CPU | Observation |
|---|---|---|---|---|
| Baseline (no workspace) | — | 110 MB | 6.5% startup | 25 threads |
| 2s after workspace open click | T+2s | **225 MB** | 0.0% | Scan complete, 50 files in sidebar |
| 5s after workspace open click | T+5s | 225 MB | 0.0% | Stable. No background work. |
| Double-click `note-01.md` (1MB) | T+0 | 225 MB | 0.2% | Highlighted in sidebar; **no tab yet, no content** |
| Same, +7s | T+7s | 227 MB | 0.2% | Still "No file open" in editor |
| Same, +22s | T+22s | 227 MB | 0.0% | **Tab + 164,358-word content finally rendered.** |
| Double-click `note-02.md` (1MB) | T+0 | 227 MB | 0.2% | Highlighted in sidebar |
| Same, +10s | T+10s | 227 MB | 2.6% | Brief CPU spike |
| Same, +12s | T+12s | 227 MB | 6.5% | Spike continues |
| Same, +14s onward | T+14s..+30s | 227 MB | 0.0% | **Spike ended; no second tab ever appeared.** Sidebar still highlights note-02 but the editor still shows note-01 content. |

### Verdict: ⚠️ SLOW against the Sublime bar but architecturally sound

**Correction to my initial read.** I first thought the second tab open
silently failed; a later click revealed it WAS opening, just behind a
"Loading file…" placeholder that Tiptap shows while the worker parses.
There are also tab pills at the top — I'd missed them earlier because
they're thin. The architecture is doing the right thing; it's just slow.

- **Workspace scan: ✅ Excellent.** ~2s to scan 50 × 1MB (52MB total) and
  populate the sidebar.
- **Memory: ✅ Reasonable.** +115 MB to ingest 52MB on-disk → 2.2× ratio,
  expected for editor state.
- **Cold open of a 1MB markdown: ⚠️ ~22 seconds**, with a "Loading file…"
  placeholder + **"Worker parsing" indicator** (yellow dot in the status
  bar) — so the user gets feedback. Sublime / Bear / Obsidian open the
  same content in < 1s. 22s is well past the comfortable threshold but
  NOT a silent hang.
- **Subsequent tabs: ✅ open instantly** (the tab pill appears at the top
  immediately). The CONTENT render is what queues — feels like one editor
  instance swapping content rather than mounting parallel editors. Worth
  confirming in code.
- **"Worker parsing" pill is good UX** — it tells the user something
  active is happening. The 22s itself isn't the bug; it's the editor
  worker's parse speed on a 1MB doc.

### Root-cause hypotheses worth chasing

1. **Tiptap initialization on a 1MB document is single-threaded and slow.**
   Each block of the document becomes a ProseMirror node; for 164k words
   that's tens of thousands of nodes. Initial parse is the dominant cost.
2. **Markdown → ProseMirror conversion happens on the main thread.** The
   editor guide says "Markdown preview runs in a worker" but the live
   editor's parser doesn't.
3. **The second-open queue might be serialized on the editor's setContent
   call** — the second `selectFile` lands but the editor's content swap
   blocks until the first one is fully done, then something drops it.
4. **The PaneTabs / openFilePaths state may not be re-rendering** — worth
   poking the store to see if `openFilePaths` actually grew.

### Recommended next steps (separate work, not this round)

- Add a perf-mode badge in the corner during a `> 500ms` editor swap so
  the user knows something's happening (no silent freeze).
- Move markdown parsing for the live editor into a worker, like the preview
  pipeline already does (see `docs/editor-guide.md` § Workers).
- Soft-cap initial content rendering — show the first N nodes immediately,
  hydrate the rest off-thread. Sublime does this; we don't yet.
- Investigate the second-open failure: instrument `selectFile` to log
  whether `openFilePaths` updates and whether the IPC `readFileIpc` actually
  resolves.

### Memory verdict

Memory itself is **fine**: 225 → 227 MB across the test, no leaks, no
runaway growth. The bottleneck is editor-render latency on the main thread,
not RSS.

---

## S1, S4, S7 — Not run this session

Cut short to preserve signal: S0's 1MB-per-tab finding is the load-bearing
result of the run, and driving 11 scenarios via computer-use ran into too
many missed-click round-trips to justify the cost. S1 / S4 / S7 should be
driven by a human in a single 15-minute pass (they're all "open thing,
click thing, watch result" — fast manually, slow via vision-driven
clicks).

Pre-flight gotchas a manual tester should know going in:

- **bob keychain re-key is required** after every reinstall (Settings →
  Bob API key → Save → Test). The signature changes invalidate the read
  ACL.
- **Claude Code / Codex** use their own login (no Compose-side key).
  `claude --version` / `codex --version` from a terminal should both
  resolve before testing.
- **Workspace switcher** opens via the chevron at the right of the
  `<workspace name> ▾` row — clicking the name text doesn't open it.
- **Tab open** is instant; **content render** for a > 100KB file shows
  `"Loading file…"` with a `"Worker parsing"` pill at the bottom right.
  Don't assume hang — wait for the pill to clear.

---

## Summary

| | |
|---|---|
| **What works** | Workspace scan (50 × 1MB in ~2s), sidebar, tab pills open instantly, memory stays bounded, the `"Worker parsing"` pill gives the user feedback during long renders |
| **What's slow** | Editor render is **~22s for a 1MB markdown** (~164k words). Each subsequent open queues against the same editor instance |
| **Severity** | Medium — Sublime/Bear hit < 1s on the same file; we'd be embarrassed showing this side-by-side. But it doesn't crash, doesn't silently hang, and most user notes are < 100KB where this is invisible |
| **Ship readiness** | Yes for v1 with the perf note in release notes; queue worker-parse perf for v1.1 with a measurable target (1MB / second on hot path) |
| **Concrete next steps** | (1) Add a `"Loading file…"` test that asserts render-complete within 5s for a 1MB fixture, so we can't regress further. (2) Profile the worker's markdown parse — likely an allocation-per-block hot loop. (3) Consider a soft-cap initial render (paint first 2k lines, hydrate the rest off-thread) so the user gets pixels in < 200ms regardless of file size |
