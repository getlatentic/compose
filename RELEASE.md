# Compose — First Release Checklist

Target: **macOS only**, v1. This is the durable, trackable gap list between
"what's built" and "shippable to a non-technical user."

Scope reminder: Compose is a local-first Markdown writing app with a built-in
AI agent. You open a folder of `.md` files; you write in a WYSIWYG/source
editor; an agent (bob / Claude Code / Codex) reads and edits your files, every
edit gated through a review-or-snapshot safety layer with undo history. App
metadata lives in app-data SQLite, never inside the vault.

> **Doc hygiene note:** the files under `docs/` (`handoff-*`, the `vellum-*`
> spec) are **partially stale** — they describe a removed Canvas/WASM editor
> and a pre-streaming Bob. The code is the source of truth; this file
> reconciles to the code as of the audit. The `docs/*-guide.md` files are
> current.

---

## Legend

- `[x]` done · `[ ]` open · `[~]` partial / needs verification
- **P0** = blocks shipping to real users · **P1** = strongly wanted for a
  credible v1 · **P2** = track, can fast-follow

---

## 0. What's already done (the strong core — no action needed)

- [x] Tiptap/ProseMirror editor: WYSIWYG + source toggle, headings, bold,
      italic, strike, inline/block code, lists, tables, task lists, links,
      images, YAML frontmatter preserved, autosave + conflict detection.
- [x] AI agent runner: real streaming (`run_harness_stream`), multi-harness
      (bob/claude/codex), cancel mid-run, tool/file-op cards, usage stats,
      full conversation CRUD.
- [x] Edit-review safety gate: clone-and-diff (default) or snapshot mode,
      per-file accept/reject, stale-edit detection, atomic apply. **The
      differentiator — well built and tested.**
- [x] Version history: per-file snapshots, undoable restore, **compression +
      count-based retention (50)** landed.
- [x] Recoverable trash: soft-delete only, 30-day startup sweep, DB-tracked.
- [x] Files/workspace: scan/read/write/create/rename/delete, atomic writes,
      file watcher, path-traversal guard, multi-workspace + tab persistence,
      binary/image writes.
- [x] Search / index / backlinks: one Rust core, native + WASM.
- [x] Comments anchored to byte-ranges, survive edits, can seed chat.
- [x] Setup / onboarding / settings: key save (keychain), CLI install + login
      flows, harness picker (model / effort / max-turns).

---

## 1. P0 — Release-engineering blockers

Without these the app cannot reach a non-technical macOS user cleanly. None of
these are product work; they're the ship vehicle.

- [ ] **Code signing + notarization.** `tauri.conf.json` has no Developer ID
      identity or entitlements (only `scripts/setup-dev-signing.sh` for local).
      Unsigned/un-notarized → Gatekeeper blocks first launch.
  - [ ] Add `bundle.macOS` signing identity + hardened-runtime entitlements.
  - [ ] Wire notarization (notarytool) into the build/release script.
  - [ ] Verify a downloaded `.dmg` opens clean on a machine that never built it.
- [ ] **Auto-updater.** No `tauri-plugin-updater`, no `updater` config. Without
      an update channel you cannot ship a single fix post-release.
  - [ ] Add `tauri-plugin-updater` + signing keypair; host an update manifest.
  - [ ] Add an in-app "update available / restart to update" surface.
- [ ] **Real README** (currently the Tauri template boilerplate) — what Compose
      is, install, first-run, support.
- [ ] **LICENSE file** (none present) — pick and add.
- [ ] **Minimal crash / error capture.** Nothing surfaces a panic or failed run
      to you today. At least log uncaught errors + agent-run failures to a local
      file the user can attach to a report. (Telemetry can stay off by default
      for privacy — see §5.)

---

## 2. P0 — Feature holes that read as "broken"

- [ ] **Remove or hide the Terminal pane.** `src/features/terminal/
      TerminalPanel.tsx` is a static stub ("planned command"). Docs call
      terminal an explicit non-goal → **remove from the shell** for v1 (cleaner
      than wiring a real PTY). Confirm no header/menu path reaches it.
- [ ] **Generic pane fallback.** `AppShell.tsx` renders "This pane type isn't
      available yet" for any non-Settings pane. Audit that no user action can
      open one; otherwise gate it.
- [~] **Prove the Bob auth round-trip in the packaged `.app`.** Streaming path
      is built but never verified end-to-end with a live key (handoff #2). Drive
      `pnpm tauri build` once: save a real key → send a prompt → confirm a real
      edit lands and review/apply works. This is a verification gap, not code.

---

## 3. P0/P1 — Document export (in scope for v1)

Decided scope: Markdown is canonical and LLM-editable; **export to HTML
always**, **DOCX/PDF via Pandoc**, plus an **agent-skill export** route. The
hard question is "what if Pandoc isn't on the machine?" — answered below.

### 3a. HTML export — P0, zero external dependency

- [ ] Reuse the existing `unified/remark/rehype` worker pipeline → standalone
      styled HTML file. **No Pandoc needed; always works.** This is the
      guaranteed path and should ship first.
- [ ] Resolve relative image paths + cross-file links so the HTML is portable.

### 3b. DOCX / PDF via Pandoc — P1, with a real no-Pandoc answer

Non-technical users won't have Pandoc installed, so **do not depend on a
system Pandoc.** Plan:

- [ ] **DOCX:** bundle Pandoc as a Tauri **sidecar** (`bundle.externalBin` +
      `externalBin` in `tauri.conf.json`). Single static binary (~100–170 MB);
      heavy but guarantees DOCX with no install step. Resolve the sidecar path
      at runtime; if a *newer* system Pandoc exists, prefer it.
- [ ] **PDF:** do **not** bundle LaTeX (multi-GB). Render the HTML route (3a)
      then **print-to-PDF via the webview/Chromium** (no LaTeX dependency).
      Fallback: `--pdf-engine=wkhtmltopdf`-style HTML→PDF if webview print is
      unavailable.
- [ ] **Graceful degradation when Pandoc is genuinely absent** (sidecar omitted
      to save size, or a stripped build): detect → if missing, surface a
      friendly "PDF/DOCX needs the converter" with (a) the always-available HTML
      export and (b) the agent-skill route below — never a dead button or a
      crash.

> **Open decision (pick one, record it here):**
> - **A — Bundle Pandoc sidecar** (+~150 MB DMG; DOCX/PDF "just work" offline).
> - **B — No bundle**, detect system Pandoc, else fall back to HTML + agent
>   skill (light DMG, but DOCX/PDF only for users who have Pandoc or run the
>   agent). *Recommended starting point: ship 3a + B, add the sidecar (A) if
>   offline DOCX/PDF proves to be a real user need.*

### 3c. Agent-skill ("export via LLM") route — P1, power path + fallback

- [ ] Offer "Export with AI": ask the active harness (Claude Code / bob, which
      carry docx/pdf/pptx skills) to convert the current file via its skill,
      through the existing run + review plumbing. Doubles as the no-Pandoc
      fallback and a power feature.

### 3d. Cross-file linking — P1 (your "can link to other file")

- [~] The index already extracts markdown + wikilinks and computes backlinks.
      **Verify/wire click-to-navigate** from a link in the editor (`[text](
      other.md)` and `[[wikilink]]`) to open that file. Surface broken links.

---

## 4. P1 — Spec v1 gates not yet demonstrably met

- [ ] **Accessibility + IME pass (spec R10).** No evidence of screen-reader /
      keyboard-only / non-Latin IME testing. Real for "AI for everyone" — at
      least a smoke pass on VoiceOver + an IME (e.g. Japanese/Pinyin).
- [ ] **Re-run the perf baseline on the current editor.** `pnpm bench:baseline`
      exists but `docs/benchmarks/baseline.*` was measured on the **removed**
      Canvas engine. Re-baseline against Tiptap so the gate is meaningful; land
      the new `baseline.json`.
- [ ] **Metadata export / import / purge UI (spec R12).** Backend pieces exist;
      no user surface to back up or delete all app data. P1 for a trust story
      ("your data, your control"), but can be a thin first cut.

---

## 5. P2 — Track, can fast-follow

- [ ] Review session is in-memory only — quit mid-review loses the sandbox
      (real files stay safe). Persist if it bites.
- [ ] Sandbox temp-dir leak on hard crash (COW, ~free) — add a startup sweep of
      stale review sandboxes.
- [ ] Trash: window hardcoded (30d), no "empty trash now" UI, sweep only at
      launch — wire to `app_settings` when a settings surface lands.
- [ ] Binary files aren't in text history.
- [ ] Table-insert toolbar dropdown (keyboard insert works today).
- [ ] Privacy/telemetry stance: if any crash capture (§1) phones home, make it
      opt-in and document it — the product promise is local-first.

---

## 6. Quality / hygiene

- [ ] **Fix stale doc:** `src-tauri/src/files/trash_sweep.rs` (module header,
      ~L14–16) still says "snapshot retention is not implemented yet (snapshots
      are unbounded)" — but it **is** implemented (`SNAPSHOT_RETENTION_LIMIT =
      50`, `prune_document_history` in `db/snapshot.rs`). The comment now
      contradicts the code; correct it and the coherence note it carries.
- [ ] **Frontend test gaps:** `setup/`, `history/`, `settings/`, `workspace/`,
      `dashboard/`, `file-tree/` have **zero** unit tests. Prioritize
      history-restore and onboarding (safety / first-impression critical).
      (Rust side is well covered — ~126 tests.)
- [ ] **Strip dev-only CSP entries** (`ws://localhost:142x`, dev URLs in
      `tauri.conf.json`) from the production build.

---

## 7. Pre-ship verification gate (run before tagging v1)

```sh
pnpm typecheck        # tsc clean, both tsconfigs
pnpm test             # vitest, all suites green
pnpm test:rust        # cargo tests green
pnpm bench:baseline   # re-baselined on Tiptap, no regression
pnpm tauri build      # signed + notarized .dmg
```

Then **drive the packaged `.app`** (a real `.app` proves what tests can't):
real key → agent edit → review/apply lands on disk → version restore →
soft-delete + recover → export HTML/DOCX/PDF → open a cross-file link. Confirm
the real file is untouched mid-run while the clone holds the edit.
