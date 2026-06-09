---
title: "Progress handoff - Files-first Bob workspace"
date: 2026-05-26
lang: en-US
---

# Progress handoff - Files-first Bob workspace

This note is for the next agent taking over the app. It describes what has been implemented, what remains, and where the current implementation intentionally differs from the earlier docs in this folder.

> **Update 2026-05-26 (later same day)**: The previous handoff has been merged into this one. Sections marked *Shipped this session* describe work that landed after the first verification snapshot.

## Current product direction

The app is now a files-first Markdown workspace:

- First-run setup requires Bob API key status and at least one workspace.
- The left rail owns workspaces and a hierarchical file tree of the active workspace.
- The middle surface is the Markdown editor with multiple open file tabs.
- Bob chat is a right-side panel scoped to the active workspace and current editor tab.
- Terminal is not first-class in the shell.

The current implementation is a working UX slice. The streaming Bob runner is the largest remaining gap.

## What is implemented

### App shell and Carbon UI

- React 18, Vite, Tauri 2, TypeScript, Zustand.
- Carbon React + Carbon icons as the UI foundation.
- Carbon Header with icon actions, left workspace/file sidebar, central editor region with status bar, right Bob panel.
- Default visible terminal panel removed from the primary shell.
- Styling centralized in [global.scss](src/styles/global.scss) using Carbon layers, spacing variables, and IBM Plex Sans.

*Shipped this session — UI polish*:

- **Sidebar** rebuilt as a hierarchical file tree ([FileTree.tsx](src/features/file-tree/FileTree.tsx)): folders are collapsible (`CaretDown`/`CaretRight`), 28px row density, depth-based indentation, dirty-dot indicator on file rows, OverflowMenu for rename/delete, hover-only quiet icon buttons.
- **Workspace section** shows the workspaces list without the duplicate active-workspace block; folder-add icon button is inline with the section header; active workspace is bolded with a 3px Carbon-focus accent.
- **Editor** ([MarkdownEditor.tsx](src/features/editor/MarkdownEditor.tsx)) dropped `basicSetup` for a minimal extension list: no line numbers, no gutter, no active-line highlight; generous typographic padding; auto-focus on mount.
- **Tabs** ([EditorTabs.tsx](src/features/editor/EditorTabs.tsx)) show filename only (full path in tooltip); 34px height; 2px Carbon-focus top stripe on active tab.
- **Status bar** at the bottom of the editor pane shows `relativePath • word count` plus a state dot (blue when dirty).
- **Bob panel** has its own slim header (icon + "Bob" + close), vertically centered empty state, pill-shaped context chip docked above the composer.
- **Header** drops the floating workspace-name `bob-header-context` div (sidebar already shows the active workspace); the dark Carbon header now casts a 1px line + soft shadow underneath so the toolbar reads as desktop chrome.
- **Panel separation** strengthened: sidebar end-border and chat start-border bumped to `border-subtle-02` (#c6c6c6).
- **Snappy**: `ChatPanel` subscribes only to `chatThread` + `activeWorkspaceId`, so editor keystrokes no longer re-render the chat panel.

### First-run setup and settings

- Setup blocks app entry until Bob auth is configured and at least one workspace exists.
- Bob API key is saved Rust-side through `keyring`.
- Renderer receives only auth status, not the API key.
- Settings dialog can update the Bob API key after setup.
- In desktop/Tauri runtime, folder opening uses `@tauri-apps/plugin-dialog`.
- Browser preview has an `Open sample workspace` path for local development.

*Shipped this session — setup redesign* ([SetupScreen.tsx](src/features/setup/SetupScreen.tsx)):

- Carbon `ProgressIndicator` with 3 steps (Save API key → Open folder → Start writing).
- Top install banner using new Rust `settings_check_bob_install` command (runs `bob --version`) with green/warning treatment.
- Tile cards labelled "Step 1" / "Step 2" with proper gating (folder choices disabled until the API key is saved).
- Tag pill on each card flips from "Required" (warm-gray) to "Done" (green) as the step completes.
- Helper text on the key field; button copy flips between "Save API key" and "Update key".

Key files:

- [SetupScreen.tsx](src/features/setup/SetupScreen.tsx)
- [SettingsDialog.tsx](src/features/settings/SettingsDialog.tsx)
- [settingsClient.ts](src/lib/ipc/settingsClient.ts)
- [src-tauri/src/settings/mod.rs](src-tauri/src/settings/mod.rs)
- [workspaceClient.ts](src/lib/ipc/workspaceClient.ts)
- [src-tauri/src/workspace/mod.rs](src-tauri/src/workspace/mod.rs)

### Workspace registration *(Shipped this session — persistence)*

Rust exposes workspace commands:

- `workspace_add`
- `workspace_remove`
- `workspace_list`
- `workspace_switch`
- `workspace_status`
- **`workspace_save_tabs`** *(new)* — persists `{activeFilePath, openFilePaths}` per workspace.

Persistence model:

- Registry now writes a JSON file under the app's config dir; survives restart.
- `WorkspaceRecord` carries an optional `tabs` field; missing tabs (v1 records) deserialize gracefully via `#[serde(default)]`.
- On startup, persisted tabs are restored into the React workspace; missing paths are filtered out after the first scan.

### Real filesystem workspace *(Shipped this session — was the largest gap)*

The seeded file list is gone in the Tauri runtime. Rust commands:

- `workspace_scan(workspaceId) -> FileEntry[]` — walkdir-based scan of `.md` files (skips hidden dirs, respects `.gitignore` only for `.git`).
- `workspace_read_file(workspaceId, relativePath) -> { content, mtimeMs }`
- `workspace_write_file(workspaceId, relativePath, content, expectedMtimeMs?) -> { mtimeMs }` — last-write-wins unless `expectedMtimeMs` is supplied; rejects when the on-disk mtime is newer.
- `workspace_create_file`, `workspace_rename_file`, `workspace_delete_file`.

All commands take `workspaceId` + a renderer-supplied relative path, then re-canonicalise against the registered workspace root in Rust — a path-traversal attempt is rejected.

File watcher:

- `notify`-based per-workspace watcher behind a `file_watcher_subscribe(workspaceId)` event channel.
- Debounced 150ms; emits `{ kind: "created" | "modified" | "deleted" | "renamed", relativePath, ... }`.
- React handler in [workspaceStore.ts](src/app/workspaceStore.ts) `handleFsEvent` reloads buffers for open dirty-free files; marks dirty files as conflicted; triggers a rescan on create/delete/rename.

Conflict UX:

- If a watched file changes on disk while the editor buffer is dirty, the [conflict banner](src/app/AppShell.tsx) appears with **Reload from disk** / **Keep my changes**.
- Conflict state is per-buffer, dismissed by either action.

Save flow:

- Cmd+S triggers `saveActiveFile`; failures surface as `saveError` in the store.
- Saving sends `expectedMtimeMs` so a stale buffer can't clobber newer disk state.

### Multiple editor tabs *(extended this session)*

- Workspaces track `openFilePaths` and `activeFilePath`.
- Persisted across restarts via `workspace_save_tabs` (called after `selectFile`, `closeFileTab`, `createNote`, `renameActiveFile`, `deleteActiveFile`, `loadActiveWorkspaceFiles`, and `handleFsEvent` rescan).
- After scan completes, the active tab's buffer is auto-loaded if it exists on disk (so restored tabs don't show "Loading file…" forever).
- Dirty-tab close confirm: `handleCloseTab` in AppShell wraps the close action with `window.confirm` when the buffer is dirty.
- `beforeunload` listener fires if **any** workspace has any dirty buffer — protects against accidental window close.

Key files:

- [workspaceModel.ts](src/app/workspaceModel.ts)
- [workspaceStore.ts](src/app/workspaceStore.ts)
- [EditorTabs.tsx](src/features/editor/EditorTabs.tsx)
- [workspaceModel.test.ts](src/app/workspaceModel.test.ts)

### Editor and Markdown live preview

- CodeMirror 6 for Markdown editing.
- Markdown worker parses and sanitizes Markdown.
- Live-preview CodeMirror plugin renders inactive Markdown blocks inline (headings, bullet/numbered lists, task checkboxes, block quotes, fenced code blocks). The active line stays editable source.
- Editor typography uses JetBrains Mono / IBM Plex Mono for source, IBM Plex Sans for rendered decorations.
- *This session*: dropped `basicSetup`. Now uses explicit extensions: `history`, `drawSelection`, `highlightSpecialChars`, `highlightActiveLine`, `bracketMatching`, `syntaxHighlighting(defaultHighlightStyle)`, `markdown()`, `lineWrapping`. Added `@codemirror/commands` and `@codemirror/language` dependencies for these.

Key files:

- [MarkdownEditor.tsx](src/features/editor/MarkdownEditor.tsx)
- [liveMarkdownPreview.ts](src/features/editor/liveMarkdownPreview.ts)
- [useMarkdownPreview.ts](src/features/editor/useMarkdownPreview.ts)
- [markdown.worker.ts](src/workers/markdown.worker.ts)
- [markdownPipeline.ts](src/workers/markdownPipeline.ts)

### Bob CLI install detection *(Shipped this session)*

- New Rust command `settings_check_bob_install()` runs `bob --version`.
- Returns `{ installed: bool, version?: string, errorMessage?: string }`.
- Implementation accepts an injected runner (`detect_bob_install<F>`) so failure paths are unit-testable. 3 inline Rust tests cover detected/missing/exit-failure.
- Surfaced in the setup screen install banner.
- **Auth verification is deferred**: an authenticated `bob` call consumes coins, so the first real chat message is what surfaces auth errors (gated on the streaming runner — see "What is left").

Key files:

- [src-tauri/src/settings/mod.rs](src-tauri/src/settings/mod.rs)
- [settingsClient.ts](src/lib/ipc/settingsClient.ts)

### Bob chat behavior

- Bob chat is open by default.
- Chat is workspace-scoped.
- Chat context is read-only and tied to the active editor tab only.
- UI no longer shows raw Bob command shape or auth status as chat content.
- Sending a message still calls `preview_bob_command` only — it does not yet spawn `bob`.

Key files:

- [ChatPanel.tsx](src/features/chat/ChatPanel.tsx)
- [workspaceModel.ts](src/app/workspaceModel.ts)
- [workspaceStore.ts](src/app/workspaceStore.ts)
- [bobClient.ts](src/lib/ipc/bobClient.ts)
- [src-tauri/src/bob/mod.rs](src-tauri/src/bob/mod.rs)

### Bob command construction

Rust builds Bob CLI command previews with:

- `--auth-method api-key`
- `BOBSHELL_API_KEY` as a secret env binding
- positional prompts (not the deprecated `-p`)
- `--output-format json` or `--output-format stream-json`
- `--chat-mode`, `--approval-mode`, `--max-coins`

There is no real streaming process runner yet.

### Markdown export

- Header has an Export Markdown action.
- Export currently downloads the active Markdown content as a `.md` file through browser Blob download.
- Does not use Pandoc; no PDF, DOCX, or HTML yet.

Key files:

- [markdownExport.ts](src/lib/export/markdownExport.ts)
- [markdownExport.test.ts](src/lib/export/markdownExport.test.ts)
- [AppShell.tsx](src/app/AppShell.tsx)

## Verification

Last verified 2026-05-26 (later):

- `pnpm test` — **29 tests passing** (13 new model helper tests, 6 filesClient browser-fallback tests added this session).
- `pnpm build` — clean (typecheck + Vite bundle).
- `cargo test --manifest-path src-tauri/Cargo.toml` — **33 tests passing** (16 added this session: files service, watcher, registry persistence, tabs persistence, path-traversal guard, Bob install detection).
- Browser preview at `http://localhost:1420/`:
  - Setup screen shows install banner + ProgressIndicator + step tiles.
  - Sample workspace flow opens the hierarchical file tree (`notes/`, `runs/`).
  - Opening a file shows tab strip with filename-only, status bar at the bottom.
  - Bob panel docks with centered empty state and pill-shaped context chip.
  - No console errors after a fresh server start.

## What is left

### Sprint 2 — Chat redesign with `@carbon/ai-chat` *(next)*

User explicitly asked for this. IBM ships [`@carbon/ai-chat`](https://github.com/carbon-design-system/carbon-ai-chat). Tasks:

- Add the dep and integrate its web component / React wrapper into the chat region.
- Map our `chatThread` (messages, prompt, context) to its API.
- Wire send → command preview for now; full streaming arrives with Sprint 3.
- Verify styling under the dark/light Carbon theme.

### Sprint 3 — Bob streaming runner *(handoff item #3, unblocks real auth verification)*

- Add `run_bob_stream({ workspaceId, prompt, contextFilePaths })`.
- Resolve cwd from `workspaceId` in Rust, never from a renderer-provided path.
- Retrieve `BOBSHELL_API_KEY` from keyring inside Rust and inject it into the child process environment.
- Spawn Bob with `--output-format stream-json`.
- Parse stdout JSON events and stream typed events to React.
- Persist chat messages and Bob run metadata.
- Add cancel/resume behavior.
- Decide what to show for tool calls and file edits in chat without exposing raw shell implementation details.
- **Auth check falls out naturally** here — the first message either lands or surfaces an auth error.

### Sprint 4 — PDF/DOCX export *(handoff item #6)*

- Keep Markdown export.
- Add Rust export service for PDF, DOCX, HTML.
- Decide whether Pandoc is a sidecar bundled with the app or a user-installed dependency.
- Track generated artifacts under workspace metadata.

### Editor quality (later)

Live preview is line/block-decoration based, not full WYSIWYG. Needed next:

- better cursor and selection behavior around bullets
- better editable list continuation
- code block editing and preview polish
- link rendering and click/edit behavior
- image and attachment handling
- table support
- syntax highlighting inside fenced code blocks

### Tabs polish (later)

- Add keyboard shortcuts for tab switching (`Ctrl+Tab`, `Ctrl+Shift+Tab`) and closing (`Cmd+W`).
- Add overflow behavior for many tabs (scroll buttons or dropdown).

### Data and search (later)

- SQLite modules are placeholders only.
- Add actual metadata database creation.
- Persist sessions, messages, runs, file index, and artifacts.
- Add workspace search.
- Add command palette only after file indexing exists.

### Terminal (later)

- [TerminalPanel.tsx](src/features/terminal/TerminalPanel.tsx) and Rust PTY descriptor types exist, but the terminal is not mounted in the primary app.
- If terminal returns, expose it as a hidden extension/tool or command-palette action, not as default layout.
- Real PTY spawn and xterm.js integration are not implemented.

## Changes that differ from the original docs

### `docs/Stack.md` says Tailwind, Radix, and Lucide

Current implementation uses Carbon React, Carbon icons, and SCSS. *Reason*: user requested IBM Carbon design guidelines.

### `docs/Stack.md` describes a separate React Markdown preview

Current implementation removed the separate preview pane in favour of inline CodeMirror live preview. *Reason*: user wanted Obsidian-like editing.

### `docs/Stack.md` treats terminal as a first-class panel

Current implementation hides terminal from the primary shell. *Reason*: user clarified terminal is an extension/tool.

### `docs/Stack.md` lists PDF/DOCX export through Pandoc

Current implementation only exports the active note as Markdown. Pandoc export is Sprint 4.

### `docs/Stack.md` expects Rust FileService and real filesystem file tree

**Now implemented** — real scan/read/write/create/rename/delete plus a `notify`-based watcher and per-workspace tab persistence.

### `docs/Stack.md` expects streaming Bob chat

Current implementation only previews the Bob command. Sprint 3 wires the streaming runner.

### Original UX plan allowed removable/manual chat context

Current implementation pins Bob context to the active tab only. *Reason*: user clarified the rule.

## Suggested next task order

1. **Sprint 2 — Chat redesign with `@carbon/ai-chat`** (user-requested next).
2. **Sprint 3 — Bob streaming runner**. Resolves cwd from `workspaceId`, injects `BOBSHELL_API_KEY` from keyring, streams `stream-json` events to the new chat UI. Real auth verification falls out here.
3. **Sprint 4 — PDF/DOCX export via Pandoc** (decide sidecar vs user-installed).
4. Editor live-preview polish (bullets, code blocks, links, tables).
5. Tab keyboard shortcuts + overflow.
6. SQLite metadata + workspace search.

## Notes for the next agent

- **Browser preview vs Tauri runtime**: IPC clients in [src/lib/ipc/](src/lib/ipc/) have in-memory fallbacks (seed file list, fake auth status, fake install version `"browser-preview"`) so the app renders in `pnpm dev`. Tauri-only behavior lives behind `isTauriRuntime()` checks. Don't remove the fallbacks — they're load-bearing for visual verification.
- **Path safety**: every file IPC re-canonicalises the renderer-supplied path against the registered workspace root in Rust before touching disk. Don't pass raw paths through.
- **Re-render hotspots**: `activeWorkspace` identity changes on every keystroke (the workspace object is rebuilt by `set((state) => …)`). `ChatPanel` selects only `chatThread` to dodge this; copy that pattern in any new heavy panel.
- **Tests to add when extending**: every new Rust command should get an inline unit test with an injected runner/state (see `detect_bob_install`). Every new TS state mutation should land with a `workspaceModel.test.ts` case.
- **Tab persistence write volume**: `persistTabs` fires on every `selectFile` — a few calls per click. If this becomes a problem (many workspaces, slow disk), add a 200ms debounce in the store.
- **`bob --version` is the only real CLI check today**: real authenticated calls cost coins, so don't add a "Test connection" button without considering that. Auth correctness is verified when the streaming runner ships.
