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

- [x] CodeMirror 6 rich editor: WYSIWYG + source toggle, headings, bold,
      italic, strike, inline/block code, lists, tables, task lists, links,
      images, math, footnotes, YAML frontmatter preserved, autosave + conflict
      detection. Per-tab state caching (cursor, scroll, undo history).
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

> **Apple Developer Program: enrolled** (individual account; Team ID `94SW7AUBMX`,
> Developer ID Application certificate). **Signing + notarization are wired** — see
> the first item below. Still gated on that: the **auto-updater** (now unblocked,
> just not built) and the **clean-machine verification** of a downloaded `.dmg`.

- [~] **[Apple] Code signing + notarization — DONE + Apple-verified; one clean-machine check left.**
      A full `scripts/build-release.sh` run produced a `.app` **and** `.dmg` both
      **Accepted by Apple's notary service**, stapled, and Gatekeeper-assessed as
      `Notarized Developer ID`. Driven entirely by env vars, so no personal identity
      lives in committed config and dev builds stay unsigned: a release sets
      `APPLE_SIGNING_IDENTITY` (Tauri signs the app, frameworks and main binary with
      hardened runtime — its default) plus `APPLE_ID` / `APPLE_PASSWORD` /
      `APPLE_TEAM_ID`. The script loads `src-tauri/.env.release` (gitignored), runs
      the build, notarizes the DMG, and verifies signature + Gatekeeper + staple.
  - [x] Enrolled; **Developer ID Application** certificate installed (Team `94SW7AUBMX`).
  - [x] Hardened runtime (Tauri default) + bundled-runtime entitlements
        (`entitlements/runtime.plist`: JIT + unsigned-memory + library-validation
        exceptions). The bundled `node` / `uv` / `uvx` are Resources Tauri doesn't
        sign, so `fetch-runtime.sh` signs them with the same Developer ID.
  - [x] Notarization + stapling of **both** the `.app` (Tauri, automatic) and the
        `.dmg` (a `build-release.sh` post-step — Tauri only *signs* the DMG wrapper).
  - [ ] Verify the downloaded `.dmg` opens clean on a machine that never built it.
- [~] **Auto-updater — wired; arming left.** Plugin, config, capabilities, and
      the in-app surface are in place: a silent launch check + a manual "Check for
      updates" in About, a download-progress banner, and relaunch. It reads a
      static `latest.json` on GitHub Releases (no backend), verifies the signed
      artifact, swaps the bundle, and relaunches. Notarization (above) is done, so
      it's unblocked. Files: `tauri-plugin-updater`/`-process`, `plugins.updater`
      in tauri.conf.json (endpoint set; **pubkey blank until armed**),
      `capabilities/default.json`, `src/lib/ipc/updater.ts`, `app/store/updaterStore.ts`,
      `features/updater/UpdateBanner.tsx`. `build-release.sh` emits the signed
      updater artifacts when `TAURI_SIGNING_PRIVATE_KEY` is set;
      `make-update-manifest.sh` writes `latest.json`.
  - [ ] **Arm once:** `pnpm tauri signer generate -w ~/.tauri/compose.key` → paste
        the PUBLIC key into tauri.conf.json `plugins.updater.pubkey`; put the
        private key + password in `src-tauri/.env.release` (see the example).
  - [ ] **Each release:** run `build-release.sh` (key set) → `make-update-manifest.sh`
        → create GitHub Release `v<version>`, upload `Compose.app.tar.gz` + `latest.json`
        → **bump the Homebrew cask** ([getlatentic/homebrew-tap](https://github.com/getlatentic/homebrew-tap)
        `Casks/compose.rb`): new `version` + `shasum -a 256` of BOTH release dmgs
        (arm64 + universal), push — a stale cask strands `brew` users on the old
        version even though the app self-updates.
- [x] **Real README** — replaced the Tauri boilerplate with a proper
      Compose README (what it is, features, dev setup, layout, docs, license).
- [x] **LICENSE file** — MIT (`LICENSE`), `license: "MIT"` added to
      `package.json`.
- [x] **Local crash / error capture.** `compose::logging` appends uncaught
      front-end errors, unhandled rejections, failed agent runs, and back-end
      panics (a panic hook) to `<app-data>/logs/errors.log` — bounded (trimmed to
      its tail past 512 KB). **Local-only, never sent anywhere**, so no consent
      needed. Settings → *Report a problem* → "Open error log" reveals it in
      Finder to attach. Installed before render in `main.tsx`. Unit-tested
      (append + trim + newline-safety).

---

## 2. P0 — Feature holes that read as "broken"

- [x] **Deleted the Terminal stub.** Removed `src/features/terminal/` (a static
      placeholder, never mounted) and the dead `src-tauri/src/pty/` module (an
      unused `PtySessionDescriptor` struct — `BobRunMode::InteractivePty`, bob's
      `-i` command builder, is unrelated and stays). A real terminal later = a
      Rust PTY (`portable-pty`) → Tauri channel → xterm.js; a separate project.
- [x] **Generic pane fallback — audited, no change.** Only `{ kind: "settings" }`
      panes are ever constructed (workspaceStore), so the "isn't available yet"
      branch is unreachable; it stays as correct defensive code for a future
      pane kind.
- [~] **Prove the agent auth + edit round-trip in the packaged `.app`.**
      Streaming path is built but never verified end-to-end with a live key.
      Drive `pnpm tauri build` once: save a real key → send a prompt → confirm a
      real edit lands and review/apply works. This is a verification gap, not
      code.
- [ ] **Open tabs can vanish, replaced by Welcome.md** (#14). `applyScanResult`
      prunes `openFilePaths` to whatever the latest scan lists, so a partial or
      racing scan drops open tabs and the empty-tabs fallback opens `Welcome.md` —
      reads as lost work. Fix: reconcile tab removal only on a confirmed `removed`
      fs-event; don't let the Welcome fallback overwrite restored tabs.
- [x] **Chat survives quit / sleep / app-switch.** A reply was only persisted on
      completion, so a logout/crash mid-stream left a one-sided conversation with
      no explanation, and the agent child orphaned (could keep editing files).
      Now: a `run_status` column + throttled incremental saves keep the partial
      reply and mark it **interrupted** on next load (a Retry, not a dead
      "thinking…"); and agent children are cancelled on app exit
      (`RunnerState::cancel_all` on `ExitRequested`) plus reaped on the next launch
      via a PID file (`harness::orphan_runs`). App-switch was already safe
      (`backgroundThrottling: disabled`). (A silence-based stall banner was
      considered and dropped — it can't tell a long tool call / thinking from a
      hang, and Stop is always available.) Needs `RunControl::pid()` in
      agent-harness (rides the `0.4.0-alpha.2` bump). Unit-tested; in-app verify
      pending.

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
- [ ] **Math/LaTeX renders as raw text** (#12) — `$…$` / `$$…$$` aren't typeset;
      the export HTML has no KaTeX. Render math into the export so PDF/HTML match
      the editor.

### 3b. HTML export — done; DOCX deferred

- [x] **HTML export** — header "Export HTML" action → `workspace_export_html`
      writes the same self-contained HTML the PDF path renders (GFM, print CSS,
      inlined images) directly — no WebKit, works on any platform. The
      dialog→save→open flow is now shared (`documentExport.ts`) between PDF and
      HTML. Unit-tested (render + path-safety); typecheck + 246 vitest.
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
- [x] **Wikilinks `[[Note]]` are now clickable** in both surfaces.
      *Editor* — a ProseMirror decoration
      ([`wikilinkExtension.ts`](../src/features/editor/wikilinkExtension.ts))
      marks `[[…]]` spans clickable while leaving the text **literal**, so
      markdown round-trips byte-for-byte (no custom node/serializer — verified
      `@tiptap/markdown` doesn't escape `[`). *Chat* — a remark plugin
      ([`remarkWikilink.ts`](../src/lib/markdown/remarkWikilink.ts)) turns
      `[[…]]` into a `#wikilink:` link (a fragment href, so it survives
      `rehype-sanitize`) that `MarkdownLink` resolves. Resolution
      ([`wikilink.ts`](../src/lib/links/wikilink.ts)) **mirrors the crate's
      rule** (`splitn('|')`, `#`-strip, path-like vs stem/slug match) so the
      editor/chat agree with the sidebar backlinks.
- [x] Verified: 14 new unit tests (resolver + remark transform incl. sanitize
      survival + inline-code exclusion), typecheck, 246 vitest, and runtime in
      the browser (modules load; `[[Daily Note|today]]` → `#wikilink:Daily%20Note`
      with alias text; `resolveWikilinkTarget('Plan')` → `notes/Plan.md`).
- [ ] **Desktop check:** confirm the editor decoration renders + ⌘-click
      navigates, and chat wikilinks navigate, against a real vault (the browser
      preview has no files/editor to exercise interactively).
- [ ] Known gap: a broken `[[Note]]` in the *editor* still looks like a link
      (the decoration doesn't resolve at paint time, only on click) — it's inert
      on click. Resolving at paint would need the file list in the plugin
      (reconfigured on change). Minor; the chat side already dims broken ones.
- [ ] Optional polish: a discoverable affordance for editor links (⌘-click is
      non-obvious for non-technical users — e.g. a hover hint).

### 3d. Print — implemented (system print panel)

- [x] **File → Print + ⌘P open the macOS print panel** (#13). A native menu item
      (set at construction, so no menu-bar flash) emits `menu://print`; the editor
      renders the active document to the same self-contained HTML as the PDF
      export and runs `NSPrintOperation` on an offscreen `WKWebView`
      ([`src-tauri/src/export/print.rs`](../src-tauri/src/export/print.rs) +
      `workspace_print`). The panel offers a real printer **and** "Save as PDF" —
      not a silent PDF-to-disk. `cargo check` + `tsc` + 547 vitest green.
- [ ] **Drive it in the packaged `.app`** — confirm ⌘P opens the panel and a page
      prints / saves as PDF correctly (the `NSPrintOperation` path needs a live
      AppKit main thread, like the PDF export).

---

## 4. P1 — Spec v1 gates not yet demonstrably met

- [ ] **Accessibility + IME pass (spec R10).** No evidence of screen-reader /
      keyboard-only / non-Latin IME testing. Real for "AI for everyone" — at
      least a smoke pass on VoiceOver + an IME (e.g. Japanese/Pinyin).
- [~] **Perf baseline.** Correction: the benchmark + `baseline.json` are already
      post-Canvas (ops are `positionMapper*` / `comment*`; no Canvas ops), so the
      gate is meaningful as-is. Re-ran `pnpm bench:baseline` to refresh the
      numbers on the current machine. (The benchmark covers the comment +
      coordinate hot paths, DOM-less.)
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
- [x] Privacy/telemetry stance: crash capture (§1) is **local-only** (a file on
      disk, never transmitted), so it honors the local-first promise with no
      opt-in. If a future "send report" ever transmits the log, make that the
      opt-in step.

---

## 6. Quality / hygiene

- [x] **Fixed stale doc:** `src-tauri/src/files/trash_sweep.rs`'s header no
      longer claims snapshot retention is unimplemented — it now describes the
      actual count-based retention (`SNAPSHOT_RETENTION_LIMIT = 50`) and why a
      trashed file's recovery snapshot (the protected latest revision) outlives
      the sweep.
- [~] **Frontend test gaps.** Added store-level tests for the file-management
      **safety paths** — `selectFile` (the cross-file-link landing: opens, loads,
      activates; caches; surfaces read errors) and `saveActiveFile` (sends the
      pre-edit mtime as the conflict guard; on a `FileConflictError` keeps local
      edits + flags the conflict instead of clobbering). The pure model safety
      logic (`applyFsEvent` dirty→conflict / clean→reload, etc.) was already
      well-covered (~40 model tests). *Still thin:* the `VersionHistory` and
      `SetupScreen` **components** have no tests — but in this node-env /
      static-render setup, effect-driven interactive components are awkward to
      test meaningfully; the load-bearing logic lives in the (tested) store +
      model. (Rust side well covered — 136 tests.)
- [ ] **Strip dev-only CSP entries** (`ws://localhost:142x`, dev URLs in
      `tauri.conf.json`) from the production build.
- [x] **Dev sample-path constant** — `browserPreviewWorkspacePath` now reads
      `import.meta.env.VITE_SAMPLE_WORKSPACE ?? "/sample-vault"` in both
      `SetupScreen.tsx` and `DashboardScreen.tsx`; no machine-specific path in
      source. *(Earlier: archived the legacy `vellum-*`/`bob4everyone` branding,
      removed dead `vellum-*` CSS, deleted the stale `src-tauri/Cargo.lock`.)*
- [~] **Launch latency diagnosed; loading screen reworked.** Instrumented the
      boot end-to-end (native `run()`/`setup()` marks + JS `markBoot`, both
      COMPOSE_PERF-gated). The slow *first* launch (~3s) is **native cold-start** —
      loading the release binary off cold disk (dyld) — **not our code**: the React
      shell paints in ~250ms, `setup()` is ~14ms, and a warm relaunch is ~770ms.
      Two levers landed: (1) a size-optimized release profile (`lto = "thin"`,
      `strip = true` in the root `Cargo.toml`; was a 25 MB **unstripped** binary)
      so the cold dyld load + signature validation are faster — `workspace-index-wasm`
      pins `wasm-opt = false` (its cached wasm-opt predates default bulk-memory
      ops); (2) the brand splash — which only blinked ~130ms before the app and
      read as a "flash" — is replaced by an empty **three-pane skeleton**
      (sidebar | editor | chat with dividers, matching the real `.workspace` grid)
      in `index.html` + `SplashScreen`, so content fills the same structure with no
      swap. Remaining cold-launch lever: **staple the notarization ticket** (offline
      Gatekeeper) in `build-release.sh`. Optional follow-up: split the shell bundle
      (defer non-critical Carbon) to trim the ~250ms first paint.

---

## 7. Pre-ship verification gate (run before tagging v1)

```sh
pnpm typecheck        # tsc clean, both tsconfigs
pnpm test             # vitest, all suites green
pnpm test:rust        # cargo tests green
pnpm bench:baseline   # perf baseline, no regression
bash src-tauri/scripts/build-release.sh   # signed + notarized + stapled .app and .dmg
```

Then **drive the packaged `.app`** (a real `.app` proves what tests can't):
real key → agent edit → review/apply lands on disk → version restore →
soft-delete + recover → export HTML/DOCX/PDF → open a cross-file link. Confirm
the real file is untouched mid-run while the clone holds the edit.
