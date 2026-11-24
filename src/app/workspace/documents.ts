import type { Workspace } from "./types";

/**
 * Which document an action is about, and what that document allows.
 */

/**
 * What a document in this container supports. Loose (external) files
 * are plain documents — the workspace-scoped machinery doesn't apply in v1 —
 * and the editor surface branches on THESE flags, not on `kind`, so the next
 * doc type (canvas, HTML) extends here instead of adding another ad-hoc check.
 */
/** Which document an export, print or render acts on: one inside a workspace,
 *  or a file opened from outside every workspace. Mirrors `DocumentRef` in
 *  `compose::export`. */
export type DocumentRef =
  | { kind: "workspace"; workspaceId: string; relativePath: string }
  | { kind: "external"; path: string };

/** Name the document a path refers to within `workspace`. A loose workspace
 *  holds files that live outside every workspace, keyed by absolute path. */
export function documentRef(
  workspace: Pick<Workspace, "id" | "kind">,
  path: string,
): DocumentRef {
  return workspace.kind === "loose"
    ? { kind: "external", path }
    : { kind: "workspace", workspaceId: workspace.id, relativePath: path };
}

/** Where the document sits, for naming a saved export after it. */
export function documentRefPath(document: DocumentRef): string {
  return document.kind === "external" ? document.path : document.relativePath;
}

export function documentCapabilities(workspace: Pick<Workspace, "kind"> | null) {
  const scoped = workspace?.kind === "real";
  return {
    comments: scoped,
    versionHistory: scoped,
    /** Pasted/dropped images persist into the workspace's `images/` dir. */
    imageInsert: scoped,
  };
}
