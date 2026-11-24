import type { PagedSource, PagedWindow } from "@latentic/live-markdown";

import { isTauriRuntime } from "../runtime/desktopRuntime";
import { invokeFile } from "./filesClient";

/** A file open a window at a time: what the paged view reads and edits, and
 *  how to save it and let go of it. */
export interface OpenedPagedFile {
  source: PagedSource;
  /** Writes the file. A file another program changed since it was read is a
   *  `FileConflictError`, unless `overChanges` says to write over it. */
  save(overChanges?: boolean): Promise<void>;
  /** The file on disk is not the one last read or written here. */
  changedOnDisk(): Promise<boolean>;
  /** Lets go of the file. The backend saves its edits first, unless
   *  `discard` says to drop them. */
  close(discard?: boolean): Promise<void>;
}

interface Opened {
  id: number;
  size: number;
}

/** Opens a workspace file without reading it. The backend keeps it open
 *  until `close()`. The browser preview holds its files in memory and has
 *  none that open this way. */
export async function openPagedFile(workspaceId: string, relativePath: string): Promise<OpenedPagedFile> {
  if (!isTauriRuntime()) throw new Error("A file this large opens only in the desktop app");
  const opened = await invokeFile<Opened>("paged_open", { workspaceId, relativePath });
  const { id } = opened;
  let size = opened.size;
  const read = (command: string, place: Record<string, number>): Promise<PagedWindow> => invokeFile<PagedWindow>(command, { id, ...place });
  return {
    source: {
      get size() {
        return size;
      },
      window: (around, target) => read("paged_window", { around, target }),
      windowFrom: (from, target) => read("paged_window_from", { from, target }),
      windowBefore: (end, target) => read("paged_window_before", { end, target }),
      edit: async (from, to, text) => {
        size = await invokeFile<number>("paged_edit", { id, from, to, text });
      },
    },
    save: async (overChanges = false) => {
      size = (await invokeFile<{ size: number }>("paged_save", { id, overChanges })).size;
    },
    changedOnDisk: () => invokeFile<boolean>("paged_changed_on_disk", { id }),
    close: (discard = false) => invokeFile<void>("paged_close", { id, discard }),
  };
}
