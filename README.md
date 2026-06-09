# Compose

**A local-first AI writing workspace — "AI for everyone."**

Compose is a desktop app for writing in Markdown with an AI agent built in. You
open a folder of `.md` files, write in a clean WYSIWYG/source editor, and let an
AI agent (bob, Claude Code, or Codex) read and edit your documents for you — with
**every edit gated through a safety review and a full undo history**.

Your files stay plain `.md` in your own folder. App data (history, comments,
search index, conversations) lives in the OS app-data directory — **never as
hidden files inside your vault**. Everything works offline.

> Status: **pre-1.0, macOS-first.** See [`RELEASE.md`](RELEASE.md) for the road
> to the first release.

---

## Features

- **Markdown editor** — Tiptap/ProseMirror, WYSIWYG + source modes, full
  Markdown (headings, emphasis, code, lists, tables, task lists, links, images),
  YAML frontmatter preserved, cross-file links, autosave, conflict detection.
- **AI agent** — streaming runs from multiple harnesses (bob / Claude Code /
  Codex), cancel mid-run, tool & file-operation cards, token/usage display, full
  conversation history.
- **Edit-review safety gate** — the agent runs against a copy-on-write clone of
  your vault; you review the diff and accept/reject per file. (Or turn review off
  and every edit is still snapshotted for one-click undo.)
- **Git-free version history** — per-file snapshots with undoable restore.
- **Recoverable trash** — soft-delete only; nothing is ever hard-deleted out
  from under you.
- **Full-text search + backlinks** — fast local index over your whole vault.
- **Comments** — anchored to text ranges, survive edits, can seed an AI chat.

---

## Tech stack

| Layer | Choice |
|---|---|
| Shell | [Tauri 2](https://tauri.app) (Rust host + system WebView) |
| UI | React 18 + TypeScript + Vite, [`@carbon/react`](https://carbondesignsystem.com) |
| Editor | [Tiptap 3](https://tiptap.dev) / ProseMirror |
| Markdown preview | `unified` + `remark` + `rehype` in a web worker |
| State | Zustand |
| Persistence | SQLite (rusqlite) in OS app-data |
| Search/index | `workspace-index` Rust core → native **and** WASM |
| AI backends | [`agent-harness`](https://github.com/getlatentic/agent-harness) crate family (bob/claude/codex) |

---

## Getting started (development)

### Prerequisites

- **Node** + [pnpm](https://pnpm.io)
- **Rust** (stable) + the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
- **wasm-pack** (`cargo install wasm-pack`) — builds the WASM search core
- For the AI agent: the relevant CLI (`bob`, `claude`, or `codex`) installed; the
  app's setup flow guides install/login.

### Install & run

```sh
pnpm install

# Browser preview (Vite + dev API server). No real filesystem/keychain;
# uses an in-memory virtual workspace. Good for UI/editor work.
pnpm dev                # http://localhost:1421

# Full desktop app (real filesystem, keychain, file watcher, agent runner).
# This is the only build that exercises the Tauri commands.
pnpm tauri dev
```

> **Browser preview vs desktop:** many capabilities (version history, the
> review gate, the keychain, the full harness catalog) are **desktop-only** and
> degrade to stubs in `pnpm dev` by design. Verify anything filesystem- or
> agent-related in `pnpm tauri dev` (and release behavior in a packaged build).

### Build

```sh
pnpm build              # wasm + typecheck + vite build (frontend only)
pnpm tauri build        # packaged macOS app (.app/.dmg)
```

---

## Verification gates

Run before declaring a change done (see [`AGENTS.md`](AGENTS.md)):

```sh
pnpm typecheck          # tsc, both tsconfigs
pnpm test               # vitest, all suites
pnpm test:rust          # cargo tests (Tauri host + crates)
pnpm bench:baseline     # editor lag benchmark; diff docs/benchmarks/baseline.json
```

For user-visible changes, the floor is "I drove it in the packaged app and
confirmed the behavior" — a passing test suite proves code correctness, not
feature correctness.

---

## Project layout

```
src/                  React/TS frontend
  app/                shell + Zustand workspace store
  features/           editor, chat, comments, file-tree, history, settings, …
  features/text/      PositionMapper (the one coordinate owner)
  lib/ipc/            Tauri command clients (+ browser fallbacks)
  workers/            markdown preview pipeline
src-tauri/            Rust host
  src/files/          atomic write, watcher, clone, trash
  src/db/             SQLite: history, snapshots, comments, conversations
  src/review/         EditGuard: clone / snapshot / diff / apply
  src/index/          full-text search command
  src/bob/            harness dispatch + streaming runner
crates/
  workspace-index/      pure index/search core (native + WASM)
  workspace-index-wasm/ WASM bindings for the browser
  bob-api/              dev-only HTTP server for browser preview
docs/                 current guides (see below) + archive/
```

## Documentation

- [`docs/spec.md`](docs/spec.md) — product & architecture overview (start here)
- [`docs/editor-guide.md`](docs/editor-guide.md) — editor, coordinates, comments, search, perf
- [`docs/ipc-guide.md`](docs/ipc-guide.md) — Tauri command threading + harness topology
- [`docs/review-guide.md`](docs/review-guide.md) — edit-review gate, version history, trash
- [`AGENTS.md`](AGENTS.md) — contributor/agent contract (`CLAUDE.md` is a symlink to it)
- [`RELEASE.md`](RELEASE.md) — first-release checklist
- [`docs/archive/`](docs/archive/) — superseded design docs (do not treat as current)

---

## License

[MIT](LICENSE) © Tosin Amuda
