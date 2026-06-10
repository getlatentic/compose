# Compose — First Release Checklist

Target: **macOS only**, v1. This is the durable, trackable gap list between
"what's built" and "shippable to a non-technical user."

Scope reminder: Compose is a local-first Markdown writing app with a built-in
AI agent. You open a folder of `.md` files; you write in a WYSIWYG/source
editor; an agent (bob / Claude Code / Codex) reads and edits your files, every
edit gated through a review-or-snapshot safety layer with undo history. App
metadata lives in app-data SQLite, never inside the vault.

> **Doc hygiene note:** the design docs now in `docs/archive/` are **stale** —
> they describe a removed Canvas/WASM editor and a pre-streaming agent. The code
> is the source of truth; this file reconciles to the code as of the audit. The
> current docs are `docs/spec.md` + the `docs/*-guide.md` files.

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
      **Requires a paid Apple Developer Program membership ($99/yr)** — a free
      Apple ID only does local/ad-hoc signing, which is not distributable.
      Notarization is included in the program (no extra cost).
  - [ ] Enroll in the Apple Developer Program; create a **Developer ID
        Application** certificate.
  - [ ] Add `bundle.macOS` signing identity + hardened-runtime entitlements.
  - [ ] Wire notarization (notarytool) + stapling into the build/release script.
  - [ ] Verify a downloaded `.dmg` opens clean on a machine that never built it.
- [ ] **Auto-updater.** No `tauri-plugin-updater`, no `updater` config. Without
      an update channel you cannot ship a single fix post-release.
  - [ ] Add `tauri-plugin-updater` + signing keypair; host an update manifest.
  - [ ] Add an in-app "update available / restart to update" surface.
- [x] **Real README** — replaced the Tauri boilerplate with a proper
      Compose README (what it is, features, dev setup, layout, docs, license).
- [x] **LICENSE file** — MIT (`LICENSE`), `license: "MIT"` added to
      `package.json`.
- [ ] **Minimal crash / error capture.** Nothing surfaces a panic or failed run
      to you today. At least log uncaught errors + agent-run failures to a local
      file the user can attach to a report. (Telemetry can stay off by default
      for privacy — see §5.)

---

## 2. P0 — Feature holes that read as "broken"

- [ ] **Delete the Terminal stub.** `src/features/terminal/TerminalPanel.tsx`
      is a ~10-line **static React component** that prints the workspace path and
      a hardcoded fake command string. There is **no PTY at all** — not node-pty,
      not a Rust/WASM PTY; `src-tauri/src/pty/mod.rs` is just an unused
      `PtySessionDescriptor` struct (no spawn, no command, not registered). The
      component is also **never imported/mounted**. For v1, **delete both**
      (`features/terminal/` + `src-tauri/src/pty/`) — terminal is an explicit
      non-goal. (Building a *real* terminal later = a Rust PTY via `portable-pty`
      → Tauri channel → xterm.js; a separate project, not a stub to finish.)
- [ ] **Generic pane fallback.** `AppShell.tsx` renders "This pane type isn't
      available yet" for any non-Settings pane. Audit that no user action can
      open one; otherwise gate it.
- [~] **Prove the agent auth + edit round-trip in the packaged `.app`.**
      Streaming path is built but never verified end-to-end with a live key.
      Drive `pnpm tauri build` once: save a real key → send a prompt → confirm a
      real edit lands and review/apply works. This is a verification gap, not
      code.

## 2a. Onboarding: auto-discover installed harnesses — done

Onboarding was **connect-centric** (it forced saving a bob key before you could
open a folder). Now it **detects which agent CLIs are already on the system** and
offers them.

- [x] **Discovery is client-side** over the existing `harness_list` +
      `harness_readiness` (the `HarnessPicker` probes the whole catalog in
      parallel). No new backend command needed.
- [x] **New onboarding step "Choose your AI"** ([`SetupScreen.tsx`](../src/features/setup/SetupScreen.tsx))
      reuses the detection-driven [`HarnessPicker`](../src/features/settings/HarnessPicker.tsx):
      each harness shows Ready ✓ / Needs sign-in / Not installed / Add a key, with
      inline install + OAuth login. Capability-driven (`harnessCapabilitiesOf`), no
      `harnessId === "bob"` checks; an inline bob-key field appears only when a
      credential-required harness is selected.
- [x] **Bob-auth gating removed from the folder step** — a user with Claude/Codex
      ready is no longer forced to configure bob; the step is non-blocking (finish
      any AI sign-in later in Settings).
- [x] Settings keeps re-probing on auth/install change (existing `HarnessPicker`
      behavior); browser preview keeps the bob-only fallback.
- [x] Verified in the browser preview (flow renders + navigates, no console
      errors) + typecheck + 220 vitest tests.
- [ ] **Desktop check:** confirm the discovery list renders in onboarding on the
      packaged app (the picker is `isTauriRuntime`-gated, so browser shows the
      fallback; the picker itself is already shipped/used in Settings).

---

## 3. Document export — PDF (decided: macOS WebKit)

**Decision:** v1 ships **PDF only**, generated by **macOS WebKit** — no Pandoc,
no LaTeX, no bundled engine. The document's current markdown → self-contained
HTML (comrak + print CSS, local images inlined as data URIs) → an offscreen
`WKWebView` produces the PDF via `createPDFWithConfiguration:`. HTML/DOCX and an
agent-skill export route are deferred (re-open below if wanted).

### 3a. PDF export — implemented (needs in-app verification)

- [x] **Backend** — `workspace_export_pdf` command:
      [`src-tauri/src/export/html.rs`](../src-tauri/src/export/html.rs) (md→HTML,
      GFM, frontmatter dropped, raw HTML escaped, images inlined; **unit-tested**)
      + [`src-tauri/src/export/pdf.rs`](../src-tauri/src/export/pdf.rs) (offscreen
      WKWebView → PDF, main-thread-safe). Path-safety via `resolve_workspace_path`.
- [x] **Frontend** — header "Export PDF" action → save dialog → open the result;
      [`pdfExport.ts`](../src/lib/export/pdfExport.ts) +
      [`exportClient.ts`](../src/lib/ipc/exportClient.ts). Capabilities updated
      (`dialog:allow-save`, `opener:allow-open-path`). Passes the *live* buffer so
      unsaved edits are included.
- [x] **Verified:** `cargo check` (native objc2/WKWebView compiles), `cargo test`
      (html renderer), `pnpm typecheck`, `pnpm test`.
- [ ] **Drive it in the packaged `.app`** — the WKWebView PDF path only runs with
      a live AppKit main thread; confirm a real document exports a correct,
      multi-page PDF with images/tables. (This is the one unverified step.)
- [ ] **Tune** if needed after first run: page size/margins (`@page` in
      `html.rs` `PRINT_CSS`), readiness timing (`pdf.rs` poll/timeout).

### 3b. Deferred export formats (re-open if wanted)

- [ ] **HTML export** — trivial follow-on: `export::html` already produces a
      standalone HTML doc; add a "save .html" path.
- [ ] **DOCX** — would need Pandoc (sidecar ~150 MB) or a pure-Rust docx writer.
- [ ] **Agent-skill export** — "Export with AI" via a harness's docx/pdf skill;
      a power path and a fallback if native export ever can't cover a format.

### 3c. Cross-file linking — markdown links done; wikilinks next

- [x] **Markdown links navigate** in both the editor (⌘/Ctrl-click) and chat
      replies (click). A pure resolver
      ([`workspaceLink.ts`](../src/lib/links/workspaceLink.ts), unit-tested)
      classifies an href as internal (resolves to a workspace file → opens in a
      tab via `selectFile`) or external (→ browser); unresolved relative paths
      are inert. Editor wired via an `onClick` handler on the editor surface;
      chat via a `components.a` override + `MarkdownLinkContext`. Sidebar
      backlinks already navigated — that's unchanged.
- [x] Verified: 11 resolver unit tests, typecheck, 231 vitest, browser render
      (no console errors).
- [ ] **Verify click-navigation in the packaged app** against a real vault with
      linked notes (the browser preview's virtual workspace has no files to link
      between).
- [ ] **Wikilinks `[[Note]]` are NOT yet clickable.** Tiptap renders `[[…]]` as
      literal text and remark doesn't parse it, so wikilink *navigation* needs
      rendering first: a Tiptap node + an input rule + markdown round-trip for
      the editor, and a remark plugin for chat. The index already resolves
      wikilink edges (`graphEdges`), so resolution is solved — only rendering is
      missing. Follow-on increment.
- [ ] Optional polish: a discoverable affordance for editor links (cmd-click is
      non-obvious for non-technical users — e.g. a hover hint), and distinct
      styling for internal vs external links (`.bob-internal-link`).

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
- [ ] **Dev sample-path constant.** `browserPreviewWorkspacePath` is hardcoded
      to `/Users/dev/workspace/bob4everyone` in `SetupScreen.tsx` and
      `DashboardScreen.tsx` (browser-preview "open sample" only). Parameterize via
      an env var (e.g. `VITE_SAMPLE_WORKSPACE`) so no machine-specific path lives
      in source. *(Done already: archived the legacy `vellum-*`/`bob4everyone`
      branding, removed dead `vellum-*` CSS, deleted the stale
      `src-tauri/Cargo.lock` leftover.)*

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
