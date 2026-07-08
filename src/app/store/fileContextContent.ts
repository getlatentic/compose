import { readFile } from "../../lib/ipc/filesClient";
import { externalReadFile } from "../../lib/ipc/externalFilesClient";
import { FILE_CONTEXT_INLINE_LIMIT, type Workspace } from "../workspaceModel";

/**
 * Gather the content of a thread's file-context items, keyed by path, for the
 * budgeted context block (`createPromptWithContext`). Open buffers (workspace
 * or loose) are already in the store — used first so unsaved edits ride along;
 * anything else is read once via the files IPC. Only the inline-budget head is
 * kept — a file longer than that is referenced by path in the prompt and read
 * on demand, so there's no point holding (or over-reading) the whole thing
 * here.
 *
 * Best-effort per file: a read failure (e.g. a spilled-paste path in app
 * scratch, or a deleted file) just omits that entry, which degrades to a
 * read-on-demand reference downstream rather than failing the send.
 */
export async function collectFileContextContent(
  workspace: Workspace,
  filePaths: string[],
  loose: Workspace | null = null,
): Promise<Map<string, string>> {
  const contentByPath = new Map<string, string>();
  const unique = Array.from(new Set(filePaths));
  await Promise.all(
    unique.map(async (path) => {
      // Absolute path = an external file (#113) or a spilled attachment: the
      // loose buffer first (live edits), then the external registry; a spill
      // matches neither and stays a read-on-demand reference.
      if (path.startsWith("/")) {
        const looseBuffer = loose?.fileContents[path]?.content;
        if (looseBuffer != null) {
          contentByPath.set(path, looseBuffer);
          return;
        }
        try {
          const file = await externalReadFile(path);
          contentByPath.set(path, file.content.slice(0, FILE_CONTEXT_INLINE_LIMIT + 1));
        } catch {
          // Omit — the prompt falls back to a read-on-demand reference.
        }
        return;
      }
      const loaded = workspace.fileContents[path]?.content;
      if (loaded != null) {
        contentByPath.set(path, loaded);
        return;
      }
      try {
        const file = await readFile(workspace.id, path);
        // A file past the inline budget is referenced, not inlined — keep just
        // enough to let the budget check classify it, not the whole payload.
        contentByPath.set(path, file.content.slice(0, FILE_CONTEXT_INLINE_LIMIT + 1));
      } catch {
        // Omit — the prompt falls back to a read-on-demand reference.
      }
    }),
  );
  return contentByPath;
}
