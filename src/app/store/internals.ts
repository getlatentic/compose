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

/** Next free `untitled-N.md` path — inside `dir` when given, else at the
 * workspace root, alongside any other notes — that collides with neither an
 * existing file, an open (possibly unsaved) tab, nor a note still being
 * created (`creating`, keyed `${workspaceId}\n${path}`). */
export function nextUntitledPath(
  workspace: Workspace,
  dir?: string,
  creating: ReadonlySet<string> = new Set(),
): string {
  const prefix = dir ? `${dir.replace(/\/+$/, "")}/` : "";
  const mine = `${workspace.id}\n`;
  const existing = new Set([
    ...workspace.files.map((entry) => entry.relativePath),
    ...workspace.openFilePaths,
    ...[...creating].filter((key) => key.startsWith(mine)).map((key) => key.slice(mine.length)),
  ]);
  let index = 1;
  while (existing.has(`${prefix}untitled-${index}.md`)) {
    index += 1;
  }
  return `${prefix}untitled-${index}.md`;
}

/** The folder a new note goes in: the one last chosen in the tree while it is
 *  still a folder of this workspace, else the top level. The choice outlives a
 *  folder's deletion and a switch to another workspace; this is where it
 *  stops applying. */
export function newNoteFolder(workspace: Workspace, chosen: string): string {
  return chosen && workspace.folders.includes(chosen) ? chosen : "";
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
