# Compose — the local-first AI Markdown editor for macOS

**AI agents edit your documents, with review and undo. No terminal, no API keys, no setup.**

Compose gives writers the power of coding agents — Claude Code, Codex, or a local
model — without any of the developer setup those tools assume. The runtime ships
inside the app, keys live in the macOS keychain (or aren't needed at all: Claude
and Codex run on the subscription you already pay for), and every AI edit goes
through a review step with full version history. Your files stay plain `.md` in
a folder you choose — readable in any other app, forever.

> **Status: early alpha.** It's stable enough that we write in it daily, but
> it *will* have rough edges — keep backups of anything irreplaceable (your
> files are plain markdown, so Time Machine or any sync folder covers you).
> macOS only for now, Apple Silicon and Intel. [Install below.](#install)

<!-- #123: 20-second demo GIF of the core loop goes here (write → ask →
     review diff → accept → restore). Until it lands, the screenshot stands in. -->
![Compose — a rich markdown editor with an AI assistant editing your documents alongside you](.github/screenshot.png)

---

## What makes Compose different

Most markdown editors bolt on a chatbot and assume you'll install and
authenticate the AI yourself. Most AI writing tools lock your work into their
cloud. Compose is neither — the full argument (and when you should pick
something else) is in [docs/positioning.md](docs/positioning.md):

- **Zero-setup agents.** Compose bundles its own Node + uv runtime and can
  install an agent for you on first run. Claude Code and Codex run on your
  existing subscription; local models run through [Ollama](https://ollama.com)
  with a one-click start. No terminal is ever required.
- **AI edits your real files — safely, without git.** Every edit is gated:
  review and accept/reject per file, or apply directly with automatic
  snapshots. Stale edits are flagged, every file has browsable version history
  with one-click restore, and deletes land in a recoverable trash.
- **Rich editor, plain files.** Headings render as headings, tables as real
  tables, images inline — but the file on disk is always standard markdown.
  Raw mode is one toggle away. No lock-in, no export step.
- **Local-first.** Your writing stays on your Mac — no account, no cloud copy.
  The editor works fully offline; the AI uses whatever agent you connect
  (a local Ollama model works with no network at all).

---

## Features

### Rich markdown editing
- Visual editor powered by [CodeMirror 6](https://codemirror.net/) — headings, bold, italic, strikethrough, inline code, and fenced code render in place
- Real table editing: click into cells, Tab/arrow between them, select rows and columns, copy as TSV
- Code blocks with syntax highlighting for 143 languages, a language chooser, and one-click copy
- Bullet lists, ordered lists, task lists (checkboxes), horizontal rules
- Inline images with drag-and-drop and paste support
- LaTeX math rendering (inline `$...$` and block `$$...$$`)
- Footnotes rendered inline
- YAML frontmatter preserved and editable as document properties
- Toggle between **Rich** and **Raw** mode per document
- Autosave as you type — edits hit disk within ~1.5 seconds

### AI assistant
- Live streaming chat — draft, rewrite, summarize, restructure, or ask questions about your writing
- Multi-agent: Claude Code, Codex, bob, and local models via Ollama — auto-discovered, or installed for you
- The assistant sees your workspace — it follows `[[wiki-links]]` between notes and understands your file structure
- Attach any note to the conversation — including files opened from outside the workspace
- Tool and file-operation cards show exactly what the agent is doing; Stop halts it mid-stream

### Edit review and safety
- **Review mode**: AI edits land in a sandbox — diff each file, accept or reject individually, then apply
- **Direct mode**: edits apply immediately with automatic version snapshots
- Stale-edit detection — if the source changed since the AI read it, the edit is flagged
- Full version history per file: browse past revisions, restore any version with one click

### Workspace and navigation
- Open any folder as a workspace — multi-workspace with tabs
- **Open any `.md` from Finder** — double-click a file anywhere and Compose edits the original in place (and can make itself the default Markdown app in Settings)
- File tree with create, rename, move, and soft-delete (recoverable trash, 30-day retention)
- Full-text search powered by a Rust/WASM index — instant results across thousands of files
- `[[Wiki-links]]`, backlinks, and standard `[markdown links](./path.md)` — ⌘-click to navigate

### Comments
- Select any passage and leave a comment — anchored to your selection
- Turn comments into AI work: send one or a batch to the assistant as a brief
- Comments panel with open/resolved sections per file

### Export
- **PDF** — native macOS WebKit rendering, multi-page with images and tables
- **HTML** — self-contained single file with inlined images and print CSS
- **Markdown** — the file itself, always

---

## Install

**Homebrew** (recommended):

```sh
brew install --cask getlatentic/tap/compose
```

**Direct download:** grab the `.dmg` from the [Releases page](https://github.com/getlatentic/compose/releases/latest) —
`aarch64` for Apple Silicon (smaller), `universal` for any Mac — open it and
drag **Compose** to Applications.

Either way the app is signed with a Developer ID and notarized by Apple, and
updates itself in the background afterwards.

**Requirements:** macOS (Apple Silicon or Intel). For AI features, connect an
agent in the app — Compose's setup walks you through it, and Node + uv ship
inside the app so there's nothing to install first.

---

## Privacy, honestly

- **Your writing never leaves your Mac.** No account, no sync, no server of ours.
- **Anonymous launch ping.** Compose sends one `app_launched` event per launch
  (app version + OS, via [Aptabase](https://aptabase.com); anonymous session id,
  no content, no file names, no personal data) so we can count active users.
  **Turn it off in Settings → General → Privacy** — the toggle is respected
  before anything is sent. Builds without an analytics key send nothing at all.
- **Update checks** fetch a version manifest from GitHub Releases.
- **Error log stays local.** Crashes and errors append to a local file
  (Settings → General → "Open error log") — it is never transmitted; you choose
  whether to attach it to a bug report.
- The AI agent you connect talks to its own provider under its own terms
  (a local Ollama model means no network at all).

---

## Roadmap

- [x] Code signing, notarization, auto-updates, Intel support
- [x] Open-with from Finder + default Markdown app
- [ ] Formatted copy/paste with Google Docs, Word, and Slack
- [ ] Resizable panels, focus mode, Mermaid diagrams
- [ ] Outside agents via MCP — with the same review-and-undo net
- [ ] Research writing: outline navigation, word-count goals, footnote navigation
- [ ] Accessibility pass (VoiceOver, keyboard-only, IME)
- [ ] Cross-platform (Windows, Linux)

The live plan is the [issue board](https://github.com/getlatentic/compose/issues) —
sprints are milestones, and every change references an issue.

---

## Build from source

```sh
pnpm install
pnpm tauri dev      # the full desktop app (real filesystem + AI agent)
pnpm tauri build    # a packaged .app / .dmg
```

**Prerequisites:** Node.js + [pnpm](https://pnpm.io), Rust + the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/), and `wasm-pack` for the search index. Built with [Tauri 2](https://tauri.app) (Rust + native WebView), React, TypeScript, [CodeMirror 6](https://codemirror.net/), and [Zustand](https://zustand.docs.pmnd.rs/). The agent layer is [`agent-harness`](https://github.com/getlatentic/agent-harness), our published Rust crate.

---

## License

[MIT](LICENSE) © Tosin Amuda
