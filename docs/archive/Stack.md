---
title: "Stack — Bob Notes (BobShell desktop wrapper)"
date: 2026-05-26
lang: en-US
---

# Stack — Bob Notes (BobShell desktop wrapper)

Local-first macOS (later cross-platform) desktop app wrapping BobShell. Workspace = a local folder. Chat with BobShell, create/edit Markdown, export to PDF/DOCX, embedded terminal.

## Decision summary

- **Shell:** Tauri 2.x (not Electron, not Swift). Start here on day 1 — the Electron→Tauri migration tax later (rewrite IPC, security model, packaging, sidecars) is real, and the bundle/memory wins compound from launch.
- **Frontend:** React 18 + TypeScript + Vite.
- **Backend:** Rust inside `src-tauri/` — workspace, files, PTY, BobShell process, export, SQLite, indexing.
- **Compute layer:** Web Workers + WASM baked in from day 1. The boundary is harder to retrofit than to design upfront — message contracts, transferables, worker lifecycle, and the build pipeline all change once code lives off the main thread.

## Architecture

```
React UI (Vite, main thread)
   │
   │  Comlink RPC          ┌── Web Workers + WASM ──────────────┐
   ├──────────────────────►│  markdown-worker   (remark/rehype)  │
   │                       │  parse-worker      (tree-sitter wasm)│
   │                       │  search-worker     (fuzzy ranking)   │
   │                       │  diff-worker       (diff algo)       │
   │                       └─────────────────────────────────────┘
   │  invoke / events (typed)
   ▼
Rust backend (Tauri)
   ├── WorkspaceService    open/validate/watch folder
   ├── FileService         read/write/rename/delete + notify watcher
   ├── BobRunner           tokio::process, streams stdout/stderr as events
   ├── PtyService          portable-pty for interactive terminal
   ├── ExportService       pandoc sidecar (DOCX/PDF/HTML)
   ├── DbService           sqlx + SQLite (sessions, runs, index)
   └── IndexService        scan + metadata, FTS later
   │
   ▼
bobshell subprocess (cwd = workspace folder)
```

**Three-tier rule:** main thread renders, workers compute, Rust owns the system.

## Why CodeMirror, xterm.js, React preview — not WASM — for those pieces

WASM has no access to the DOM. Anything that puts pixels on screen, handles a cursor, dispatches keyboard events, or manages IME and accessibility needs a JavaScript layer. WASM is the engine room — JS still steers.

| Component | Why it stays in JS/DOM | What WASM/workers do for it |
|---|---|---|
| **CodeMirror 6** (editor) | The editor view is DOM: lines, decorations, cursors, selections, gutter, scrollbar. It has to handle IME, virtual keyboards, the accessibility tree, drag/drop, system clipboard. WASM can't touch any of that — you'd still need a JS rendering layer on top, which is what CodeMirror already is. It's also already incremental (Lezer parser). | Off-thread syntax via `web-tree-sitter` in `parse.worker`. Heavy lint/outline work in workers. The DOM view stays in CodeMirror. |
| **Markdown preview** (React) | "Preview" *is* a DOM tree — headings, links, code blocks, embeds. WASM can produce an AST, but the AST→DOM render step has to happen on the main thread. | `markdown.worker` runs the full remark/rehype pipeline (parse, sanitize, transform). Main thread receives a hast JSON tree and renders it via React. The expensive part is already off-thread. |
| **xterm.js** (terminal display) | A terminal renderer is a character grid on canvas/WebGL, an ANSI escape-sequence interpreter, a scrollback buffer with selection, copy/paste, link detection, accessibility. xterm.js is what VS Code and most modern web terminals use. Reimplementing it in WASM is a multi-year project with no upside — the display still has to live in the DOM. | The actual terminal — PTY allocation, the running shell, byte streaming — is in Rust (`portable-pty`). xterm.js just renders bytes that Rust forwards. |

**General rule:** WASM is for computation, not presentation. Treating it as a replacement for a UI framework is a category error. Going fully custom (à la Zed or Warp) means writing your own renderer in native code and budgeting years for it — wrong order of magnitude for wrapping BobShell.

## What lives where

| Layer | Owns | Does NOT do |
|---|---|---|
| **React (main thread)** | DOM, layout, focus, keyboard/mouse, theme, drag/drop, animations, routing, calling workers and Rust through typed clients | Parsing, diffing, ranking, filesystem, processes, network I/O |
| **Web Workers + WASM** | Markdown parse (remark/rehype), syntax (tree-sitter), fuzzy ranking, diff calculation, any pure CPU work | DOM access, direct filesystem, holding canonical state |
| **Rust (Tauri backend)** | Filesystem (read/write/watch), BobShell subprocess, PTY allocation, SQLite, Pandoc sidecar, workspace lifecycle, security boundary | Rendering, layout, anything user-visible |

Concrete flows:

- **User edits a file** — React captures keystroke → CodeMirror updates DOM → debounced text sent to `markdown.worker` → worker returns hast JSON → React renders preview. Save fires → Rust `FileService` writes to disk.
- **User types in chat** — React invokes `runBobPrompt` → Rust spawns/streams BobShell → emits `bob:stdout` / `bob:file-created` events → React appends to virtualized chat list and refreshes the file tree on file events.
- **User opens command palette** — React renders `cmdk` UI → query string sent to `search.worker` → worker fuzzy-ranks against the file index Rust supplied → React renders ranked results.
- **User opens a terminal tab** — React mounts xterm.js → invokes Rust `pty.spawn` → Rust allocates a PTY and runs zsh → byte chunks stream back as events → xterm.js renders. Keystrokes flow the other way: xterm.js → invoke `pty.write` → Rust.

## Frontend choices

| Concern | Pick | Notes |
|---|---|---|
| Editor | CodeMirror 6 + `@codemirror/lang-markdown` | Lezer incremental parse, lightweight vs Monaco |
| Preview | `unified` + `remark` + `rehype-sanitize` **in `markdown.worker`** | Parse off-main-thread from v1; main thread only renders the hast |
| Chat UI | React + `@tanstack/react-virtual` | Virtualize from day 1; chat grows fast |
| File tree | React + virtualized tree | Render only; sorting/filtering data comes from Rust |
| Terminal | `xterm.js` + `xterm-addon-fit` + `xterm-addon-web-links` | UI only; PTY in Rust |
| Worker bridge | `comlink` | Type-safe RPC to workers, hides postMessage boilerplate |
| Syntax (code blocks) | `web-tree-sitter` (WASM) in `parse.worker` | Incremental, grammars loaded on demand |
| Fuzzy search | `nucleo` (WASM) or `fzf-for-js` in `search.worker` | Powers command palette + file switcher |
| Diff | `diff-match-patch` in `diff.worker` | Editor history, conflict resolution |
| State | Zustand | No Redux boilerplate; selectors prevent re-renders |
| Styling | Tailwind + Radix UI primitives | Headless, accessible by default |
| Command palette | `cmdk` (UI) + `search.worker` (ranking) | Linear/Raycast feel |
| Icons | Lucide | Tree-shakeable |

## Worker + WASM layout (day 1)

```
src/workers/
├── markdown.worker.ts     remark/rehype pipeline, returns hast JSON
├── parse.worker.ts        web-tree-sitter, language grammars on demand
├── search.worker.ts       fuzzy ranking over file index + commands
├── diff.worker.ts         diff-match-patch for editor + chat artifacts
└── shared/
    ├── comlink.ts         typed RPC wrappers
    └── transferables.ts   ArrayBuffer helpers to avoid copy cost
```

Conventions:

- Workers are stateless request/response unless they own a cache (`parse.worker` holds the tree-sitter `Parser` instance).
- Use `transfer()` for any payload over ~10 KB to skip structured-clone overhead.
- Each worker exposes a Comlink-typed interface; React calls them like async functions.
- WASM grammars live in `public/wasm/`, fetched on first use and cached in memory.

The principle: **the boundary belongs in v1; the implementation inside the boundary can stay naive.** It's cheap to swap a worker's internals later. It's expensive to move synchronous main-thread code onto a worker after the UI has grown around it.

## Rust backend crates

```
tokio              async runtime
serde / serde_json IPC payloads
notify             filesystem watch
portable-pty       cross-platform PTY
sqlx               SQLite, compile-time checked SQL
tantivy            full-text search (Phase 4)
tracing            structured logs
thiserror          typed error enums for commands
```

## Storage

- **Markdown files** stay as plain `.md` on disk — never lock the user in.
- **SQLite** at `<workspace>/.bobapp/metadata.sqlite` via `sqlx`:
    - `sessions`, `messages` — chat history
    - `runs` — BobShell invocations + log paths
    - `files_index` — path, mtime, size, frontmatter, hash
    - `artifacts` — generated exports
- BobShell logs in `<workspace>/.bobapp/logs/`.

## Security (Tauri capability system)

- Lock `tauri.conf.json` capabilities to the selected workspace path only — no broad FS access.
- All Rust commands explicitly listed in `invoke_handler!`.
- CSP locked; no `unsafe-eval`.
- BobShell spawned with an explicit env allowlist, not full `process.env`.
- Renderer never sees raw shell strings — only typed commands like `runBobPrompt`, `exportDocx`.

## Project layout

```
bob-notes/
├── src/                       React + TS
│   ├── app/                   shell, routing, layout
│   ├── features/
│   │   ├── chat/
│   │   ├── editor/
│   │   ├── file-tree/
│   │   ├── terminal/
│   │   └── workspace/
│   ├── lib/
│   │   ├── ipc/               typed wrappers around invoke()
│   │   └── workers/           Comlink client wrappers (typed)
│   ├── workers/               markdown, parse (tree-sitter), search, diff
│   └── main.tsx
├── public/
│   └── wasm/                  tree-sitter grammars (.wasm), fetched on demand
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── workspace/
│   │   ├── files/
│   │   ├── bob/
│   │   ├── pty/
│   │   ├── export/
│   │   ├── db/
│   │   ├── index/
│   │   └── events.rs
│   ├── binaries/              pandoc sidecar per-platform
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
└── vite.config.ts
```

## Build order

**Phase 1 — Skeleton + worker scaffold (Week 1–2)**
1. `pnpm create tauri-app` → Vite + React + TS template.
2. Configure Vite for workers (`?worker` imports) and WASM (`vite-plugin-wasm`).
3. Stand up `markdown.worker.ts` + Comlink client; render preview from worker output from the first commit.
4. Workspace picker → Rust `WorkspaceService`, persist last opened.
5. File tree from Rust scan, virtualized in React.
6. CodeMirror 6 editor — open, edit, save `.md`.

**Phase 2 — BobShell loop + search/parse workers (Week 3–4)**
7. `BobRunner` in Rust with `tokio::process::Command`.
8. Stream `stdout`/`stderr` as Tauri events (`bob:stdout`, `bob:file-created`, …).
9. Chat UI: virtualized history, streaming token buffer.
10. Wire chat → run → file events → tree refresh.
11. SQLite + `sqlx` for sessions, messages, runs.
12. `search.worker.ts` powering a basic command palette (commands + open files).
13. `parse.worker.ts` with `web-tree-sitter` loading markdown + one code grammar (e.g. TypeScript) for syntax in preview.

**Phase 3 — Polish (Week 5–6)**
14. xterm.js terminal panel + Rust `portable-pty`.
15. Pandoc sidecar for DOCX/PDF export.
16. `diff.worker.ts` wired into editor history.
17. `notify` file watcher for external edits.
18. Settings/preferences (theme, font, BobShell path).

**Phase 4 — Scale-out (when telemetry warrants it)**
- SQLite FTS5 → Tantivy in Rust for workspace-wide search.
- More tree-sitter grammars, lazy-loaded.
- Local embeddings (Rust + `ort` / onnxruntime) for semantic search.
- SharedArrayBuffer + multiple worker instances for parallel parse on huge files (needs COOP/COEP headers in Tauri).
- Cross-platform: Tauri already builds Linux/Windows; only the PTY path needs care.

## Explicitly not doing

- **Electron** — bundle/memory tax not worth a future rewrite.
- **Swift/SwiftUI** — only if the product pivots to a "premium Mac-native writing app."
- **Web Components everywhere** — friction without payoff here.
- **A WASM editor / WASM terminal** — WASM can't render; you'd still need a JS shell. Use CodeMirror and xterm.js.
- **Cloud backend** — fully local-first. Add sync only when there's a real user need.
- **Custom editor** — use CodeMirror 6, do not reinvent.

## Mental model

```
React        = interface (renders, never blocks)
Workers      = compute (parse, search, diff, syntax) — from v1
WASM         = inside workers, for grammar/parsing speed
Rust         = local power (files, processes, index, export)
xterm.js     = terminal display
portable-pty = real terminal backend
SQLite       = durable session/index store
Pandoc       = export engine
BobShell     = agent runtime, isolated subprocess
```
