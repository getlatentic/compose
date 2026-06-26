# Compose — the AI-native markdown editor for macOS

**Write in a rich editor. Edit with AI agents you already use. Everything stays on your Mac.**

Compose is a local-first writing app that combines a rich markdown editor — where you see headings, bullets, and images instead of raw syntax — with AI assistants that read and rewrite your documents directly. No cloud account, no proprietary format: your files are plain `.md` in a folder you choose, editable in any other app.

The AI doesn't live in a separate window. It sees the document you're working on, edits it in place, and every change goes through a review step with full version history — so an AI edit is always one click from being undone.

> **Status:** early alpha (`0.0.1-alpha.4`), macOS — Apple Silicon and Intel. [Download below.](#download)

![Compose — a rich markdown editor with an AI assistant editing your documents alongside you](.github/screenshot.png)

---

## What makes Compose different

Most markdown editors bolt on a chatbot. Most AI writing tools lock you into their format. Compose is neither:

- **Rich editor, plain files.** You write in a clean visual view — headings render as headings, bullets as bullets, images inline — but the file on disk is always standard markdown. Switch to raw mode anytime. No lock-in, no export step.
- **Your AI tools, not ours.** Compose works with the agents you choose — [Claude Code](https://claude.ai/claude-code), [Codex](https://github.com/openai/codex), bob, or a local model via [Ollama](https://ollama.com). You pick the model, provider, and plan. Compose discovers what's on your system, and — because it bundles its own Node + uv runtime — can install an agent for you with nothing to set up first.
- **AI edits your real files — safely.** The assistant writes directly into your documents, but every edit is gated: review and accept/reject per file, or let edits apply with automatic snapshots for one-click undo. The AI can never quietly lose your work.
- **Local-first, private by default.** Your writing never leaves your device — no account, no sync, and your notes are never uploaded anywhere. The editor works fully offline; the AI uses whatever agent you've connected. The only thing Compose ever reports is an anonymous, opt-out app-open count (active users + OS and app version — never note content, file names, or personal data); turn it off in **Settings → Privacy**.

---

## Features

### Rich markdown editing
- Visual editor powered by [CodeMirror 6](https://codemirror.net/) — headings, bold, italic, strikethrough, inline code, and block code render in place
- Bullet lists, ordered lists, task lists (checkboxes), tables, horizontal rules
- Inline images with drag-and-drop and paste support
- LaTeX math rendering (inline `$...$` and block `$$...$$`)
- Footnotes with inline preview
- YAML frontmatter preserved (never stripped, never corrupted)
- Toggle between **Rich** and **Raw** mode per document
- Autosave as you type — edits hit disk within ~1.5 seconds

### AI assistant
- Live streaming chat — ask the AI to draft, rewrite, summarize, restructure, or answer questions about your writing
- Multi-agent support: Claude Code, Codex, bob, and local models via Ollama — auto-discovered on your system
- The assistant sees your full workspace — it follows `[[wiki-links]]` between notes and understands your file structure
- Cancel a run mid-stream, adjust model/effort/turn limits per session
- Tool and file-operation cards show exactly what the agent is doing

### Edit review and safety
- **Review mode**: AI edits land in a sandbox — diff each file, accept or reject individually, then apply
- **Direct mode**: edits apply immediately with automatic version snapshots
- Stale-edit detection — if the source changed since the AI read it, the edit is flagged
- Full version history per file: browse past revisions, restore any version with one click

### Workspace and navigation
- Open any folder as a workspace — multi-workspace with tabs
- File tree with create, rename, move, and soft-delete (recoverable trash, 30-day retention)
- Full-text search powered by a Rust/WASM index — instant results across thousands of files
- `[[Wiki-links]]` and backlinks — click to navigate in the editor or chat
- Standard `[markdown links](./path.md)` navigate between files (⌘-click in the editor)

### Comments
- Select any passage and leave a comment — the composer anchors to your selection
- Turn a comment into an AI request: send it to the chat and the assistant responds
- Queue multiple comments to batch-send later
- Comments panel with open/resolved sections per file

### Export
- **PDF** — native macOS WebKit rendering, Computer Modern typeset, multi-page with images and tables
- **HTML** — self-contained single file with inlined images and print CSS
- **Markdown** — download the raw `.md` file

---

## Roadmap

Compose is in active development. Here's what's next:

- [x] **Code signing and notarization** — signed with a Developer ID and notarized by Apple; installs with no Gatekeeper warning
- [x] **Auto-updater** — ships updates that download and apply in the background
- [x] **Intel support** — a universal build runs on any Mac; Apple Silicon gets a leaner arm64 download
- [ ] **Canvas documents** — a Mural/Miro-style infinite canvas with sticky notes, text, and images
- [ ] **HTML documents** — create and edit rich HTML alongside markdown
- [x] **Editor as a standalone package** — the rich markdown editor extracted as [`ai-editor`](packages/rich-editor) (decoupled, builds to `dist/`, npm-publishable)
- [ ] **Accessibility pass** — VoiceOver, keyboard-only navigation, and IME support
- [ ] **Cross-platform** — Linux and Windows support via Tauri

---

## Download

Compose is signed with a Developer ID and notarized by Apple — it installs like any other Mac app, and updates itself after that.

1. Download the latest `.dmg` from the [**Releases page**](https://github.com/getlatentic/compose/releases/latest):
   - **Apple Silicon (M1 or newer):** `Compose_…_aarch64.dmg` — the smaller download.
   - **Any Mac (Intel or Apple Silicon):** `Compose_…_universal.dmg`.
2. Open it, drag **Compose** into your Applications folder, and double-click to launch.

New versions then download and apply in the background — no need to come back here.

**Requirements:** macOS, Apple Silicon or Intel. For the AI features you'll connect an agent — [Claude Code](https://claude.ai/claude-code), [Codex](https://github.com/openai/codex), bob, or a local model via [Ollama](https://ollama.com) — and Compose's setup walks you through it (Node + uv ship inside the app, so there's nothing to install first).

---

## Build from source

```sh
pnpm install
pnpm tauri dev      # the full desktop app (real filesystem + AI agent)
pnpm tauri build    # a packaged .app / .dmg
```

**Prerequisites:** Node.js + [pnpm](https://pnpm.io), Rust + the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/), and `wasm-pack` for the search index. Built with [Tauri 2](https://tauri.app) (Rust + native WebView), React, TypeScript, [CodeMirror 6](https://codemirror.net/), and [Zustand](https://zustand.docs.pmnd.rs/).

---

## License

[MIT](LICENSE) © Tosin Amuda
