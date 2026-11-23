import type { PagedSource, PagedWindow } from "@latentic/live-markdown";

import { invokeFile } from "./filesClient";

/** A file open a window at a time: what the paged view reads from, and how
 *  to let go of it. */
export interface OpenedPagedFile {
  source: PagedSource;
  close(): void;
}

interface Opened {
  id: number;
  size: number;
}

/** Opens a workspace file without reading it. The backend keeps it open
 *  until `close()`. */
export async function openPagedFile(workspaceId: string, relativePath: string): Promise<OpenedPagedFile> {
  const { id, size } = await invokeFile<Opened>("paged_open", { workspaceId, relativePath });
  const read = (command: string, place: Record<string, number>): Promise<PagedWindow> => invokeFile<PagedWindow>(command, { id, ...place });
  return {
    source: {
      size,
      window: (around, target) => read("paged_window", { around, target }),
      windowFrom: (from, target) => read("paged_window_from", { from, target }),
      windowBefore: (end, target) => read("paged_window_before", { end, target }),
    },
    close: () => void invokeFile<void>("paged_close", { id }),
  };
}
