import type { Workspace } from "../workspaceModel";

/** Replace one workspace in the array via a transform, leaving the rest by
 * reference. The workhorse for every workspace-scoped state update. */
export function updateWorkspace(
  workspaces: Workspace[],
  workspaceId: string,
  transform: (workspace: Workspace) => Workspace,
): Workspace[] {
  return workspaces.map((workspace) =>
    workspace.id === workspaceId ? transform(workspace) : workspace,
  );
}

/** Best-effort human message from an unknown thrown value. */
export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  // Tauri `invoke` rejects with a plain String, not an Error — surface it
  // instead of masking the real backend reason behind the generic fallback.
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

/** Next free `untitled-N.md` path — at the workspace root, alongside any other
 * notes — that collides with neither an existing file nor an open (possibly
 * unsaved) tab. */
export function nextUntitledPath(workspace: Workspace): string {
  const existing = new Set([
    ...workspace.files.map((entry) => entry.relativePath),
    ...workspace.openFilePaths,
  ]);
  let index = 1;
  while (existing.has(`untitled-${index}.md`)) {
    index += 1;
  }
  return `untitled-${index}.md`;
}

/**
 * Prefix the sent prompt with the one piece of context only the app knows: which
 * file the user is currently looking at, as an absolute path. The working
 * directory itself is stated by the harness — in the openai-compatible system
 * prompt's trailing environment section, and by the Claude/Codex CLIs' own
 * environment — so it isn't repeated here. Added to the *sent* prompt only; the
 * user-visible chat message stays clean.
 */
export function prefixWorkspaceContext(
  prompt: string,
  workspaceRoot: string | undefined,
  activeFilePath: string | null | undefined,
): string {
  if (!activeFilePath) {
    return prompt;
  }
  const root = workspaceRoot?.trim().replace(/\/+$/, "");
  const absolutePath = root ? `${root}/${activeFilePath}` : activeFilePath;
  return `The user is currently viewing the file \`${absolutePath}\`.\n\n${prompt}`;
}
