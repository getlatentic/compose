# ADR 0001 — Table editing: block widget with `contenteditable` cells

**Status:** Accepted (design). Implementation pending.

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

1. Harden pure model + ops tests in Node (mostly done — foundation proven).
2. Stand up Vitest browser mode (WebKit) + a real-caret smoke test — retires jsdom.
3. Build the `<table>` + `plaintext-only` + stable-lifecycle widget + bridge, growing
   it to green the `@browser` scenarios.
4. **Delete** `tableCellSubview.ts` and the nested-editor machinery. The redesign is
   largely subtraction.
