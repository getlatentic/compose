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

/** Next free `notes/untitled-N.md` path that collides with neither an existing
 * file nor an open (possibly unsaved) tab. */
export function nextUntitledPath(workspace: Workspace): string {
  const existing = new Set([
    ...workspace.files.map((entry) => entry.relativePath),
    ...workspace.openFilePaths,
  ]);
  let index = 1;
  while (existing.has(`notes/untitled-${index}.md`)) {
    index += 1;
  }
  return `notes/untitled-${index}.md`;
}

/**
 * Prefix every harness prompt with the workspace context so the model knows
 * where it is — its working directory is the workspace root, and which file is
 * in focus — instead of hunting for files (the cause of the "let me search for
 * this file" flailing). Added to the *sent* prompt only; the user-visible chat
 * message stays clean.
 */
export function prefixWorkspaceContext(
  prompt: string,
  workspaceRoot: string | undefined,
  activeFilePath: string | null | undefined,
): string {
  const root = workspaceRoot?.trim() || "the current folder";
  const viewing = activeFilePath
    ? ` The user is currently viewing \`${activeFilePath}\` (relative to that directory).`
    : "";
  return (
    `You are working in a local Markdown workspace. Your working directory is ` +
    `\`${root}\` — read and edit files directly by their path relative to it; ` +
    `do not search for them.${viewing}\n\n${prompt}`
  );
}
