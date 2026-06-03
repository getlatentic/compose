# Tauri IPC + command-threading guide

Read this before adding or editing a `#[tauri::command]`. The rule
here is the difference between a responsive native window and a
beachball, and it is invisible in the dev/browser build — so it does
not show up until you run the packaged `.app`.

## Crate topology (who depends on whom)

The harness layer lives in its **own repository** —
[`github.com/getlatentic/agent-harness`](https://github.com/getlatentic/agent-harness)
— which Compose consumes from **crates.io** as ordinary version deps
(`src-tauri` + `crates/bob-api`). It is a published crate family; the
dependency arrow only ever points *up*. The
layout below — and the "Adding a harness adapter" steps — describe **that**
repo, not this one:

```
cli-stream     generic streaming subprocess engine: spawn_streaming /
   |           ProcessEvent / ProcessHandle / InstallEvent / augmented_node_path.
   |           No agent / harness knowledge.
   ├── bob-rs        unofficial bob SDK (detection, install, keychain,
   │                 `spawn_bob`). → cli-stream ONLY → truly standalone.
   │      ▲
   └── agent-harness   the umbrella, imported as `harness`: the `Harness`
                       trait + `RunEvent` + `normalize_process_event` + the
                       open `Registry`, plus the built-in bob/claude/codex
                       adapters as feature-gated modules (`harness::bob`
                       wraps bob-rs; claude/codex use cli-stream). Re-exports
                       the engine. → cli-stream + bob-rs (optional, `bob` feat).
          ▲
   ├── src-tauri   desktop host; every #[tauri::command] resolves the
   │               active harness through agent-harness's registry.
   └── bob-api     dev-only axum server (browser preview) — bob-rs only.
```

If you find yourself wanting `cli-stream` to know about `Harness`, or
`bob-rs` to depend on the harness framework — stop. That separation is what
keeps `bob-rs` a standalone SDK and avoids a dependency cycle (the umbrella
wraps `bob-rs`, so `bob-rs` must not depend back on it). Process-streaming
primitives go in `cli-stream`, bob CLI I/O in `bob-rs`, the harness
abstraction + adapters in `agent-harness`.

Product naming: this codebase is **Compose** — a local-first AI
writing workspace, "AI for everyone." `bob` is one *harness* (agent
backend) Compose can drive, not the product; see the registry in
`agent-harness`. Don't reintroduce a product name other than Compose
into this repo.

## Adding a harness adapter

A *harness* implements `harness::Harness` (info / readiness / install / run
/ credential / login). The built-in adapters live as **modules** of
`agent-harness` (`harness::bob` / `harness::claude` / `harness::codex`,
feature-gated, re-exported as `Bob` / `Claude` / `Codex`); a **third party**
adds their own out-of-tree (depend on `agent-harness`, `impl Harness`,
`Registry::register` it — no fork). To add a built-in, copy
`agent-harness/src/codex.rs` and change:

1. **Binary + flags** in `run()` (e.g. `claude -p --output-format
   stream-json …` vs `codex exec --json …`). Spawn via
   `crate::spawn_streaming` (the engine re-exported from `cli-stream`: PATH
   augmentation, reader threads, SIGTERM/SIGKILL cancel). Pass per-harness
   secret env in its `env` arg, or none if the CLI manages its own auth.
2. **A line parser** `parse_<harness>_line(&str) -> ParsedLine` that
   decodes that CLI's stdout wire format. Run each raw event through
   `crate::normalize_process_event(event, parser)` so the front-end only
   ever sees the normalized `RunEvent`. **Ground the wire format in the
   tool's docs and unit-test the parser** — do not guess; a wrong parser is
   silent data loss.
3. **readiness** (`<bin> --version` probe) and **credential**
   (`required: false` if the CLI owns its own login, like Claude/Codex;
   `true` if Compose stores the key, like bob).

Then add a `#[cfg(feature = "…")] pub mod` + the `Bob`-style re-export in
`agent-harness/src/lib.rs`, and a `.register()` line in `default_registry()`
(`agent-harness/src/registry.rs`); the hosts pick it up (the catalog +
`harness_by_id` derive from the registry). An out-of-tree provider just
calls `Registry::register(MyHarness::new())`.

CLI agents that edit files directly (Claude, Codex) emit no
suggested-edit previews — their edits land on disk and the file
watcher reflects them; `ParsedLine.edits` stays empty. Only bob
proposes previewable edits today.

On the live run path: the **neutral transport is `run_harness_stream`**
(not `run_bob_stream` — the pipe is product-neutral; bob is one
harness on it). It routes by `harness_id`: bob keeps its richer Tauri
path (locator + workspace-aware argv + attached context files); every
other harness id is dispatched to `run_via_harness`, which resolves the
harness through the registry, builds a neutral `RunRequest` (carrying
the user's `RunTuning` — model / effort / max-turns), and streams its
normalized `RunEvent`s on the same channel (`HARNESS_RUN_EVENT`) +
runner state, so cancel (`cancel_harness_run`) + run bookkeeping work
identically. The Settings picker persists the selection + per-harness
options and the chat send forwards them. So Claude Code / Codex are
user-reachable today.

**Harness errors are typed; stringify at the boundary.** `Harness`'s
`install` / `run` / `login` and `RunControl::cancel` return the typed
`harness::HarnessError` (Spawn / Install / Login / Cancel / Other), so the
*adapter* can branch on the kind of failure. Compose's Tauri commands stay
`Result<_, String>` — the front-end only ever sees a rejection string — so
**`.map_err(|e| e.to_string())` (or `error.to_string()`) at the command /
run-event boundary** in `runner.rs`, the single place the typed error meets
the wire. Don't propagate `HarnessError` into the command signature or the
`HARNESS_RUN_EVENT` payload; the boundary is where it collapses to text.

**Capabilities, not id checks.** Each harness declares a
`HarnessCapabilities` (on `HarnessInfo`): `credential_required`,
`previews_edits`, model list, `allows_custom_model`, `supports_effort`,
`supports_max_turns`. The frontend loads the catalog once
(`loadHarnessCatalog`) and every branch reads capabilities via
`harnessCapabilitiesOf(...)` — the credential/install preflight
(`sendChatPrompt`, ask-about-selection), the chat availability gate,
the "plan vs code" mode, and which option controls the Settings panel
renders. **Do not reintroduce `harnessId === "bob"` checks.** A harness
that needs a stored key sets `credential_required: true` and the
preflight fires for it automatically; a `"bob"` literal that should
have been a capability is exactly how "I selected Codex but it told me
to connect bob" happens. Only `credential_required` harnesses get the
preflight — login-managed CLIs surface a missing login as *their own*
run error.

## The one rule: commands do I/O ⇒ commands are `async`

> Tauri docs: "Commands without the *async* keyword are executed on
> the main thread unless defined with *#[tauri::command(async)]*."
> "Asynchronous commands are preferred in Tauri to perform heavy work
> in a manner that doesn't result in UI freezes or slowdowns."

A synchronous `#[tauri::command]` (a plain `fn`) runs on the **main
thread** — the same thread that owns the WebView event loop and
processes every click and keystroke. The instant such a command does
blocking work — keychain read, filesystem scan, SQLite query,
spawning the `bob` CLI — the **entire native window freezes** until it
returns. On macOS you get the spinning-rainbow beachball, which is the
OS telling you the app's main thread is not responding.

So: **every command in this app is `#[tauri::command(async)]`.** None
of them touch the window/webview synchronously; they all do I/O and
report back through the thread-safe `AppHandle` / `Channel`. There is
currently no command that needs to be on the main thread. If you add
one that genuinely does (e.g. direct window manipulation that the
Tauri API requires on the main thread), that is the rare exception —
document *why* at the call site.

`#[tauri::command(async)]` on a synchronous-bodied `fn` is the right
tool: it keeps the blocking body (we *want* blocking SQLite/keychain
calls — they are simple and correct) but runs the whole body on a
Tauri worker thread instead of the UI thread. You do **not** need to
rewrite the body as `async fn` with `.await` everywhere.

## Why this is invisible in dev

In the browser-preview path, these same operations are HTTP calls to
the `bob-api` axum process (see `crates/bob-api`). That process runs
on its own threads, so the browser's UI thread never blocks — the app
feels fine. The freeze only appears in the packaged Tauri build, where
the command runs in-process. **"It's smooth in `pnpm dev` but the
`.app` beachballs" is the signature of a sync command doing I/O.**
Do not chase it in the React layer; React re-renders cannot cause a
native beachball.

## State + async: it just works here

All managed state (`WorkspaceRegistry`, `MetadataStore`,
`BobRunnerState`, `WorkspaceIndexStore`, `WatcherManager`) is
`Mutex`-backed and therefore `Send + Sync`, so `State<'_, T>`
arguments compile fine on `async` commands. The compiler enforces
this — if you add state that is not `Send + Sync`, `cargo check` will
reject the async command, which is the correct signal to fix the
state, not to drop back to a sync command.

## Concurrency consequence (a feature, not a bug)

Because async commands run on worker threads, two commands can run at
once. This is what makes `cancel_harness_run` able to flip the cancel
flag while `run_harness_stream` is parked in the keychain prompt — both are
`(async)`, so Stop is never queued behind a blocked run. Shared state
is already serialized by its internal `Mutex`, so concurrent commands
cannot race on data; just don't assume command A finishes before
command B starts unless the frontend `await`s A first.

## Checklist when adding a command

1. Does the body read/write the filesystem, DB, keychain, network, or
   spawn a process? → `#[tauri::command(async)]`. (In practice: always
   yes here.)
2. Register it in `src-tauri/src/lib.rs` `invoke_handler![...]`.
3. If it streams progress, take a `Channel<T>` and `send` from a
   worker — never block the command waiting on the whole stream.
4. Verify in the **packaged build** (`pnpm tauri build`, launch the
   `.app`), not just `pnpm dev`. The dev path cannot reveal a
   main-thread block (see above).
