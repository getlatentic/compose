import { createPagedMarkdownView, type PagedSource } from "@latentic/live-markdown";
import { useEffect, useRef } from "react";

import { selectFocusedWorkspace } from "../../app/store/activeWorkspace";
import { largeFileKey } from "../../app/store/internals";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { formatFileSize } from "./formatFileSize";
import { usePagedFile } from "./usePagedFile";

/** The open file when it is too large to read whole: shown a window at a
 *  time, and not edited. */
export function LargeDocument() {
  const workspaceId = useWorkspaceStore((state) => selectFocusedWorkspace(state)?.id ?? "");
  const path = useWorkspaceStore((state) => selectFocusedWorkspace(state)?.activeFilePath ?? "");
  const sizeBytes = useWorkspaceStore((state) => state.largeFiles[largeFileKey(workspaceId, path)] ?? 0);
  const file = usePagedFile(workspaceId, path);

  return (
    <section className="editor-body large-document" aria-label={path}>
      <p className="large-document__note" role="note">
        This file is {formatFileSize(sizeBytes)}. It is shown a part at a time and cannot be edited here yet.
      </p>
      <LargeDocumentBody file={file} />
    </section>
  );
}

function LargeDocumentBody({ file }: { file: ReturnType<typeof usePagedFile> }) {
  switch (file.status) {
    case "opening":
      return <p className="large-document__status">Opening…</p>;
    case "failed":
      return (
        <p className="large-document__status" role="alert">
          {file.message}
        </p>
      );
    case "open":
      return <Pages source={file.source} />;
  }
}

/** The file's text, a few windows of it at a time. */
function Pages({ source }: { source: PagedSource }) {
  const pages = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pages.current) return;
    const view = createPagedMarkdownView(pages.current, source);
    return () => view.destroy();
  }, [source]);

  return <div ref={pages} className="large-document__pages" />;
}
