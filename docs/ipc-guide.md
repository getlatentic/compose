# Tauri IPC + command-threading guide

Read this before adding or editing a `#[tauri::command]`. The rule
here is the difference between a responsive native window and a
beachball, and it is invisible in the dev/browser build — so it does
not show up until you run the packaged `.app`.

## Crate topology (who depends on whom)

```
bob-core      pure unofficial bob SDK: detection, install, run,
              keychain. No Tauri, no axum, no Compose, no harness
              abstraction. Kept standalone so it can be published.
   ▲
compose-core  Compose's neutral agent-harness layer: the `Harness`
              trait, the `bob` adapter (wraps bob-core), the
              registry. Depends on bob-core — NEVER the reverse.
   ▲
   ├── src-tauri   desktop host; every #[tauri::command] resolves the
   │               active harness through compose-core's registry.
   └── bob-api     dev-only axum server (browser preview); same.
```

The dependency arrow only ever points *up*. If you find yourself
wanting `bob-core` to know about `Harness`, `compose-core`, or a
second backend — stop. That coupling is what the split exists to
prevent: bob-core must stay shippable on its own. Put the new
abstraction in `compose-core` (or a future sibling), and have it
depend on bob-core.

Product naming: this codebase is **Compose** — a local-first AI
writing workspace, "AI for everyone." `bob` is one *harness* (agent
backend) Compose can drive, not the product; see the harness registry
in `compose-core`. Don't reintroduce a product name other than
Compose into this repo.

## Adding a harness adapter

A *harness* implements `compose_core::Harness` (info / readiness /
install / run / credential) and is registered in `registry()` +
`harness_by_id()`. Existing adapters: `bob` (`lib.rs` `BobHarness`),
`claude` (`claude.rs`), `codex` (`codex.rs`). The shape for a
process-backed CLI harness is fixed — copy `codex.rs` and change:

1. **Binary + flags** in `run()` (e.g. `claude -p --output-format
   stream-json …` vs `codex exec --json …`). Spawn via
   `bob_core::spawn_streaming` — the shared engine (PATH augmentation,
   reader threads, SIGTERM/SIGKILL cancel). Pass per-harness secret
   env in its `env` arg, or none if the CLI manages its own auth.
2. **A line parser** `parse_<harness>_line(&str) -> ParsedLine` that
   decodes that CLI's stdout wire format. Run each raw event through
   `events::normalize_process_event(event, parser)` so the front-end
   only ever sees the normalized `RunEvent`. **Ground the wire format
   in the tool's docs and unit-test the parser** — do not guess; a
   wrong parser is silent data loss.
3. **readiness** (`<bin> --version` probe) and **credential**
   (`required: false` if the CLI owns its own login, like Claude/Codex;
   `true` if Compose stores the key, like bob).

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
