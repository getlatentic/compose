# Port to `agent-harness`: RunEvent additions + parser rerouting

Main moved the harness layer (RunEvent, the bob parser, `normalize_bob_event`)
out of this repo into the external crate family at
<https://github.com/tosinamuda/agent-harness> (consumed here as the
`harness` / `bob-rs` git dependencies). The chat overhaul on this branch
depends on **backend event changes that now belong in that repo** — they
can't live in this app repo anymore.

`agent-harness-runevent.patch` (diff against the shared baseline
`ac6e813` ≡ main `f6502c7`) carries them. Apply the *intent* in
`agent-harness`, not the patch verbatim (paths differ there).

## What to port

1. **`RunEvent` gains three variants** (in the harness crate's events module):
   - `Notice { run_id, message }` — process *narration* (bob's plain
     assistant `message`s), distinct from `Text` (the answer).
   - `Session { run_id, session_id, model }` — from bob's `init`.
   - `Usage { run_id, total_tokens, tool_calls, coins }` — from bob's
     `result.stats` (`coins` ← `session_costs`, grounded on a real run).
   - `ToolStart` gains `input: Option<String>`; `ToolEnd` gains
     `output: Option<String>`. (`RunEvent` drops `Eq` — `coins` is f64.)

2. **`parse_bob_line` rerouting** (the bob adapter):
   - plain assistant `message` → `notice` (was `text`); `BobStreamParser`
     splits `<thinking>` out of `notice`, not `text`.
   - `tool_use` → `tool_start` **with** compact-JSON `input`.
   - `tool_result` → `tool_end` **with** `output`.
   - `attempt_completion` → `text` (the answer) — unchanged.
   - `init` → `session`; `result` → `usage` (`total_tokens` / `tool_calls`
     / `session_costs`).
   - `[using tool …]` echo lines stay dropped (`is_tool_status_echo`).
   - `normalize_process_event` emits thinking **before** notice for a
     `reasoning</thinking>narration` split (ordered trace on the FE).

3. **The runner must use the *stateful* parser.** The desktop bridge in
   `src-tauri/src/bob/runner.rs` calls `harness::normalize_bob_event`
   (stateless) — which never runs the `<thinking>` state machine, so the
   raw tags leak. Either export a stateful `BobStreamParser` from
   `agent-harness` and have the runner hold one per run, or make
   `normalize_bob_event` stateful internally. (The runner-side change is
   in the patch but parked because runner.rs is now harness-refactored on
   main.)

## After porting
- Bump the `agent-harness` / `bob-rs` git pins in `src-tauri/Cargo.toml`.
- The frontend already consumes `notice` / `session` / `usage` / tool
  input+output (added to `HarnessRunEvent` in `bobClient.ts`), so the
  three-surface chat UI lights up once the backend emits them. Until then
  it degrades gracefully (no narration → status falls back; no usage → no
  stats float; tags may leak until the stateful-parser fix lands).
