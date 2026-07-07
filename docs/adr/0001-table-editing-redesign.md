# ADR 0001 — Table editing: block widget, native cell editing, pure model

**Status:** Accepted (design). Editing surface pending a two-way spike (§Editing
surface). Implementation pending.

## Context

WYSIWYG table editing on CodeMirror 6 was built as an **atomic block widget whose
cells each mount a nested CodeMirror instance**. That creates two editing worlds
(two selection/focus systems, two DOM update loops) and every table bug we hit —
invisible caret, wrong caret position, caret flash, focus race, caret escaping the
table, empty-cell caret — is a *handoff bug between those two worlds*.

We keep CM6 (not TipTap/Lexical) for two non-negotiables of a **vault editor**:
- **Source fidelity.** The file on disk is the user's real Obsidian-vault Markdown;
  CM6 edits that source directly (zero round-trip risk). Document-model editors
  convert to/from Markdown and can silently normalize/corrupt vault files.
- **Large-file performance.** Only CM6 virtualizes the viewport (1MB+ files).

## Decision

Replace the nested-CodeMirror cells with **one block widget rendering a real
`<table>` whose cells are `contenteditable="plaintext-only"`**. Markdown stays the
source of truth in the CM6 document. Partition every interaction into:

- **NATIVE** — the browser owns intra-cell caret, click-to-position, arrows within a
  cell, selection within a cell, basic deletion, IME. (This deletes the nested-CM
  caret/focus race class.)
- **PURE** — a Markdown table model owns structure (parse/serialize, add/delete
  row/column). Already exists and is **proven** (Lezer-based reader; see
  `tableModelGfm.test.ts`, 8/8 GFM edge cases: escaped pipes, alignments, empty/
  uneven cells, bare GFM, inline-code pipes, source ranges, back-to-back tables).
- **BRIDGE** — thin, deterministic, testable: cell `input`→source sync, paste
  normalization, Tab/Shift-Tab between cells, arrow/Backspace/Delete at cell
  boundaries, exit before/after table, row/column/table commands, copy
  serialization for visual selections.

### Non-negotiable implementation constraints (from review)

1. **`contenteditable="plaintext-only"`, not `true`** — cells store text, not
   browser-generated HTML. (Baseline since Mar 2025.)
2. **Stable widget lifecycle.** The widget DOM is persistent; CM must not rebuild
   it mid-edit. Implement `eq()` + `updateDOM()` to patch in place, and save/restore
   the cell selection across transactions. *This is the make-or-break risk* — get it
   wrong and "nested-CM caret bugs" become "contenteditable selection lost on
   redraw" bugs.
3. **CM6 history is the canonical undo.** Intercept `beforeinput`
   `historyUndo`/`historyRedo` in cells and route to CM; contenteditable keeps no
   own undo stack.
4. **Source-mode (RAW) fallback** stays for tables the widget can't handle.

## Editing surface: two candidates behind one seam

The model, bridge rules, commands, selection overlay, and menu are identical
either way; only *where typing physically happens* differs. That is a swappable
interface (`CellEditingSurface`), and the choice is made on evidence, not taste.

**B — `contenteditable="plaintext-only"` cells in the widget.** Most "inline"
feel; Obsidian 1.5's table editor is this pattern. Its two standing risks are
disciplines, not one-time fixes: widget redraw must never destroy the focused
cell (`eq()`/`updateDOM()` + selection restore), and the cell's DOM selection
lives inside CM's content DOM next to CM's MutationObserver.

**C — floating overlay editor (the spreadsheet model: Excel/Sheets/Notion).**
The widget is pure render; clicking a cell positions one shared editor over the
cell rect, **portaled outside CM's DOM**. Both B-risks vanish by construction:
a redraw just repositions the overlay, and CM's observer never sees the edit.
External doc changes mid-edit (AI auto-apply, iCloud sync, autosave reload —
all real in Compose) cannot kill the editing surface. Cost: an "editor appears
over the cell" seam (invisible when styled identically) and rect tracking on
scroll/resize.

**Also considered:** styled-source tables (decorate pipes + measured padding;
the only one-selection-model design, but caps WYSIWYG fidelity and can't wrap
long cells — held as fallback, not pick) and per-table raw reveal (exists as
the RAW fallback). Rejected as traps: CSS-grid on CM lines (breaks height
measurement), embedding ProseMirror for tables (two worlds again), windowing
libraries (already litigated).

**Decision gate:** spike B and C behind `CellEditingSurface` (~a day each) and
pick in real WebKit on: (1) survive a widget redraw mid-edit, (2) survive an
external doc change mid-edit, (3) no selection/focus casualty across 20
scripted edit-navigate-edit rounds. B wins ties (more inline); any casualty →
C. Either way, **commit on boundaries** (blur/Tab/Enter/structure op), never
per keystroke — the doc must not churn (nor the widget redraw) mid-typing, and
a cell edit stays one undo step.

### Spike results (2026-07-07) — B selected, C retained as fallback

Both surfaces were implemented behind the seam (`tablev2/`) and ran the full
gate in real WebKit (`surfaceGate.browser.test.ts`), with lifecycle **path
proofs** (patch = cell element identity preserved; recreate = element
replaced):

| Condition | B inline | C overlay |
|---|---|---|
| G1 widget PATCH mid-edit (text/caret/focus + live typing after) | pass | pass |
| G1b full widget RECREATE mid-edit (external add-row) | pass | pass |
| G2 external edit to another cell merges on commit | pass | pass |
| G3 20 begin→type→commit rounds, zero casualties | pass | pass |

Per the pre-agreed rule (both clean → B wins ties), **B — inline
`plaintext-only` cells — is the production surface.** Findings that must carry
into the build:

- B passes **only with the state-mirror discipline**: live text + caret are
  mirrored into surface state on every input/selection change, and `reanchor`
  (called after every doc change) restores text/attr/focus/caret onto whatever
  element currently renders the cell. The gate observed updateDOM clobbering
  the edited cell and the restore recovering it — naive B (state in the DOM
  only) would have failed G1/G1b.
- The feared CM MutationObserver/selection fight **did not materialise** in
  WebKit: real keystrokes into an editable cell inside a block widget ran 20+
  rounds and mid-edit churn with zero focus casualties.
- Cell source ranges are resolved **at commit time** from the fresh model
  (never cached), which is what makes G2's concurrent-edit merge clean.
- C stays implemented behind the same seam as the drop-in fallback; if deeper
  integration (drawn-caret interplay, IME, scroll) surfaces B casualties,
  swapping is a one-line change.

## Interaction matrix

| # | Interaction | Lane |
|---|---|---|
| 1–2 | Awareness before/after table | Bridge (exit to widget from/to) |
| 3 | Click text in a cell | Native |
| 4 | Arrows within cell / at cell edge | Native / Bridge |
| 5 | Mouse can't escape the table | Native (real editable target) |
| 6–10 | Add/delete row, column, table | Pure |
| 11–13 | Select row / column / table | Bridge (visual overlay + copy) |
| 14 | Backspace/Delete in cell / at start | Native / Bridge |
| 15 | Right-click cell/row/column/table | Bridge |

## Testing (the jsdom answer)

jsdom has no layout engine, so geometry/caret tests silently pass there. Split the
suite; ~80% of code is PURE by design and tests in Node.

| Tier | Runner | Covers |
|---|---|---|
| Pure model + bridge rules | Vitest (Node) | parse/serialize, add/del row/col, alignment, escaped pipes, `(row,col,offset,key)→action` |
| Browser behavior | **Vitest browser mode → Playwright WebKit** | real caret, click placement, selection, boundary keys, copy/paste, IME smoke |
| Real webview (optional) | WebdriverIO + Tauri | shipped-webview differences |

Every interaction (1–15) is a Gherkin scenario tagged `@pure` or `@browser`.

Test WebKit now (Compose v1 is macOS-only). Add Chromium when Windows ships —
Tauri is **not** single-engine in general (WebView2/Chromium on Windows/Android).

## Honest framing

This is **architecturally sane, not "bug-free."** It replaces one bug class
(nested-CM focus/caret races) with a smaller, *named and tested* one (contenteditable
boundaries + widget lifecycle). The remaining risk lives in specific, testable
places, not scattered through focus transitions.

## Plan / what gets deleted

1. ~~Harden pure model + ops tests in Node~~ — done (tableModelGfm 8/8).
2. ~~Vitest browser mode (WebKit) + real-caret smoke~~ — done (`pnpm test:browser`).
3. ~~Spike surfaces B and C; run the gate~~ — done; B selected (see Spike results).
4. ~~Build the surface + bridge to green the scenarios~~ — done: bridge rules
   (27 pure tests), click-to-edit at point, entry/exit, whole-cell selection +
   TSV copy, structure menu, hover inserters, CM-owned undo, focusout commit —
   32 real-WebKit tests.
5. ~~Delete the nested-editor machinery~~ — done: tableCellSubview, V1
   tableWidget, tableSelection, tableEntry, tableHoverControls removed;
   `tableField` now builds V2 widgets so atomicRanges/armed-delete/
   deleteNormalizer/visiblePosition were untouched; `tableExtension` is a
   per-composition factory (one surface per editor).

Remaining follow-ups: wire `planned/table-editing.feature` scenarios to step
definitions (coverage exists as plain tests today); row/column/table-select UI
triggers (math + copy are built); Chromium browser-tier when Windows ships.
