# ADR 0002 — Code blocks: text-native, with real affordances

**Status:** Accepted. Nested highlighting landed; opener affordances planned.

## Context

The fence INPUT mechanics are solid after the §12 work (type-time close,
enter/step-in/exit, opener/closer re-site, Tab indent, marker rows refusing
the caret — interaction-spec §12.4–12.9, all conformance-tested). What makes
code blocks feel "hacky" is missing PRESENTATION and AFFORDANCES:

- no syntax highlighting — code renders as monochrome text;
- the language is invisible (CodeInfo is `hide-always`) and there is no way
  to choose or change it after §12.4 auto-closes the fence — the info string
  is only editable in RAW mode;
- no copy-code, no per-block affordances at all.

## Decision: code stays TEXT-NATIVE (deliberately the opposite of tables)

Tables are 2D grids — a bad fit for a line editor, hence ADR 0001's widget.
Code is 1D lines — exactly CM6's native model. Keeping code as real document
lines means caret, selection, undo, IME, search, and viewport virtualization
are all native, and the two-worlds problem cannot exist here. The redesign is
therefore ADDITIVE affordances, not an architectural replacement:

1. **Nested syntax parsing + highlighting (LANDED).**
   `markdown({ codeLanguages: languages })` (@codemirror/language-data) mounts
   the real grammar for a fence's info string, lazily imported per language.
   `codeHighlight` (decorations/codeHighlight.ts) styles ONLY code-emitted
   tags — markdown's own constructs stay with the decoration registry and
   editorTheme, so nothing double-styles. Proven by
   `codeLanguages.test.ts` — note the probe gotcha: mounted overlay trees are
   invisible to `tree.iterate`; assert via `resolveInner` ancestor chains.

2. **Opener-row language pill (NEXT).** A small widget replacing the hidden
   CodeInfo on CLOSED fences: shows the language (or "plain"), click opens a
   searchable menu built from `languages` (name + aliases); choosing writes
   the info string as a normal doc change (one undo step). Typing a language
   on an UNCLOSED opener keeps working (§12.7's pasted-fence flow);
   autocompletion while typing an info string is a follow-up.

3. **Hover copy-code button (NEXT).** Top-right of the block on hover,
   clipboard-writes the fence content (unescaped). Reuses the table hover
   pattern: delegated listener, subtle chip, no per-block listeners.

4. **Follow-ups considered, not scheduled:** collapse for long blocks;
   per-language indent size; rendered previews for `mermaid`.

## Reuse from ADR 0001 (what generalises)

- The **browser test tier** is the verification home for any
  geometry/caret/visual behavior (the pill + copy button test there).
- The **hover-affordance pattern** (delegated listener + lazily attached
  chips, reposition gated on target change) ports directly.
- The **stable widget lifecycle discipline** (eq/updateDOM, no rebuild while
  interacting) applies to the pill widget.
- Candidate next adopters of the *editing-surface* idea itself: the **math
  block** (edit LaTeX in a plaintext-only island with live preview) is the
  closest analogue; the image widget needs only the lifecycle discipline.

## Testing

| Behavior | Tier |
|---|---|
| Nested parse mounts per info string; unknown language stays plain | Node/jsdom (resolveInner) |
| Pill renders language, menu writes info string, undo is one step | WebKit browser tier |
| Copy button writes fence content | WebKit browser tier |
| Existing §12 input mechanics | already covered (conformance + features) |
