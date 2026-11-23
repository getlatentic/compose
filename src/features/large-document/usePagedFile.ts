import type { PagedSource } from "@latentic/live-markdown";
import { useEffect, useState } from "react";

import { openPagedFile } from "../../lib/ipc/pagedClient";

/** A file being opened a window at a time. */
export type PagedFile =
  | { status: "opening" }
  | { status: "open"; source: PagedSource }
  | { status: "failed"; message: string };

const OPENING: PagedFile = { status: "opening" };

/** Opens the file without reading it, and lets go of it when the path
 *  changes or the screen goes. */
export function usePagedFile(workspaceId: string, relativePath: string): PagedFile {
  const [file, setFile] = useState<PagedFile>(OPENING);

  useEffect(() => {
    let left = false;
    let close: (() => void) | null = null;
    setFile(OPENING);
    openPagedFile(workspaceId, relativePath).then(
      (opened) => {
        // The screen left before the file opened: let go of it at once.
        if (left) return opened.close();
        close = opened.close;
        setFile({ status: "open", source: opened.source });
      },
      (error: unknown) => {
        if (!left) setFile({ status: "failed", message: error instanceof Error ? error.message : "Could not open the file" });
      },
    );
    return () => {
      left = true;
      close?.();
    };
  }, [workspaceId, relativePath]);

  return file;
}
