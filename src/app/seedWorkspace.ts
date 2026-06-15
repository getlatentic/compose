export interface SeedWorkspaceFile {
  markdown: string;
  path: string;
}

export const seedWorkspaceFiles: SeedWorkspaceFile[] = [
  {
    path: "notes/launch-plan.md",
    markdown: `# Launch plan

Compose starts as a notes-first workspace. Files are the center, and your AI collaborator is available from the right panel when the work needs help.

## Phase 1

- Open a folder
- Write Markdown notes
- Attach active files to the assistant
- Export the current note as Markdown

## Product direction

Keep chat scoped to the active workspace. The transcript should read like a direct conversation tied to the open note.
`,
  },
  {
    path: "notes/editor-contract.md",
    markdown: `# Editor contract

The main thread owns DOM input and focus. Markdown parsing belongs to the worker boundary from the first commit.

## Flow

React captures edits, the worker parses Markdown, and inactive blocks render inline while the current block stays editable.
`,
  },
  {
    path: "runs/streaming.md",
    markdown: `# Streaming

Assistant responses should stream into the chat panel when the runner is connected. Until then, the UI should never pretend a response exists.
`,
  },
];
