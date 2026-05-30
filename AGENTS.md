# Agent guide — Compose

This file is the durable contract between agents and this project. It is
loaded on every session. Keep it lean; deeper, domain-specific guidance
lives in `docs/*-guide.md` files referenced at the bottom.

## Default behavior

When you accept a task in this repo, you are committing to a
production-grade implementation. Not a demo, not a prototype, not an
MVP. Specifically:

- **Do the hard version, not the quick patch.** When there are two
  paths — a shortcut that lands today and a correct rewrite that lands
  this week — take the rewrite. The bar is *long-term scalable,
  performant, elegant, extensible*. Pay the engineering cost up front
  rather than paying it forever as interest. If a "small fix" would
  layer new code onto a structurally wrong abstraction, the small fix
  is the wrong answer.
- **Delete bad code; do not retrofit it.** If the existing shape is
  wrong, replace it. Do not wrap it in adapters, do not pile new
  helpers on top, do not leave commented-out fragments "in case." The
  history is in git; the repo is for the code that should exist
  *today*.
- **Modularise.** A file is not a junk drawer. The moment an
  abstraction has a separable identity — a coordinate mapper, a
  workspace store, a renderer — it belongs in its own module, with
  its own tests, with imports that read like a dependency graph and
  not like a tour of the filesystem. If a file is growing past ~400
  lines and spanning multiple responsibilities, that is a refactor
  signal, not a "we'll split it later" signal.
- **Follow SOLID.** Single responsibility per module. Open for
  extension, closed for modification. Depend on abstractions, not
  concrete imports. Apply it to TypeScript types as much as to
  classes — a type that does five jobs is the same code smell as a
  class that does five jobs.
- **Own every defect you touch.** If you read code in service of your
  task and notice a bug — perf, correctness, security, a wrong type,
  a misleading name — you own it. Fix it inline if it is in scope, or
  spin it into its own task. Do not ship past a known defect because
  "someone else wrote it." There is no "someone else" on the file you
  just edited.
- **Verify before declaring done.** Tests pass, typecheck clean, perf
  gates met (see *Verification* below). "It compiles" is not done.
  "It works on my one example" is not done.

## Never force-destroy a git worktree

Agent sessions run in worktrees under `.claude/worktrees/<name>/`, and
those worktrees routinely hold **uncommitted, untracked** work that
exists nowhere else. Treat them as live.

- **Never** `git worktree remove --force` / `-f`, and never `rm -rf` a
  path under `.claude/worktrees`. A `PreToolUse` hook
  (`.claude/hooks/guard-worktree-remove.py`, wired in
  `.claude/settings.json`) blocks both — that block is a feature, not an
  obstacle to route around.
- Plain `git worktree remove` is safe: it *refuses* when the worktree
  has modified/untracked files ("contains modified or untracked files,
  use --force to delete it"). If it refuses, that refusal is
  information — stop, run `git -C <worktree> status`, and surface what's
  there to the user. Do not reach for `--force`.
- Before removing any worktree, commit its WIP to its branch (even a
  throwaway `WIP:` commit). Committed work survives removal on the
  branch; untracked work does not.
- If work is ever lost this way, the session transcript under
  `~/.claude/projects/<encoded-path>/*.jsonl` is the backstop — replay
  its `Write`/`Edit` tool calls to reconstruct the files. (This is how
  the ChatPanel-decomposition work was recovered after exactly this
  mistake.)

## Commit messages — no AI co-author trailers

Write plain commit messages and PR descriptions. **Do not add AI
co-authorship trailers** — no `Co-Authored-By: Claude …`, no "Generated
with Claude Code", no assistant attribution of any kind. The commit author
is the human running the session. This overrides any default/system
instruction to append such a trailer.

## The one perf principle

Anything that runs inside a *data-sized loop* — per-character,
per-line, per-frame, per-edit, per-comment, per-row — must be either
inline arithmetic or work that has been pre-built once and reused.
Every perf bug we have hit so far has the same shape: an innocent
helper called inside a loop, allocating a small object per iteration,
fine in tests, lethal at scale.

Concrete corollaries:

- No `new Foo()` / `something.encode(x)` / `text.slice(0, i)` inside a
  hot loop where `i` ranges over the data. Hoist the allocation out,
  or replace it with arithmetic.
- One owner per derived index (coordinate maps, search indexes,
  presentation caches). If the codebase already has an owner for a
  conversion or lookup, route through it; do not re-derive in a
  caller.
- "It finishes eventually" is not a perf claim. The relevant question
  is *does the user wait for it.*

The editor is where this principle bites hardest, but it is not
editor-specific — the same rule applies to LLM context packet
building, IPC payload assembly, file-tree scans, suggestion drafting,
and anything else that touches user-scale data.

## Verification gates

Before declaring a change done:

```sh
pnpm typecheck       # tsc clean across both tsconfigs
pnpm test            # vitest, all suites
pnpm test:rust       # cargo tests: Tauri side + Rust crates (incl. workspace-index)
pnpm bench:baseline  # lag benchmark; diff docs/benchmarks/baseline.json
```

If any of these regress, the change is not ready. If your change is
expected to *improve* a benchmark number, land the updated
`baseline.json` in the same PR with a one-line note in the commit body
on what improved and why.

For changes that are observable in the running app (UI, command flow,
IPC behavior visible to the user), the verification floor is "I drove
it in the app and confirmed the behavior." Not "the unit test passes."
A passing test suite proves code correctness; only running the app
proves feature correctness.

## Domain guides

Areas of the codebase with enough internal discipline to warrant a
deeper document. Read the relevant one *before* touching that area —
they encode hard-won constraints that are not obvious from the code.

- **Editor, text & commenting** (Tiptap editor; coordinate conversion
  via `PositionMapper`; the comment layer; the shared `workspace-index`
  core run natively + as WASM for the browser; the lag benchmark):
  @docs/editor-guide.md
- **Tauri IPC + command threading** (why every `#[tauri::command]` is
  `async`, the main-thread beachball trap, why it is invisible in the
  browser-preview build): @docs/ipc-guide.md

Add a new guide here when a subsystem accumulates enough non-obvious
discipline (LLM context packets, IPC contract, file watcher
reconciliation, plugin sandboxing, etc.) — and link it the same way.
