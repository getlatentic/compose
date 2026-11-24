import type { PagedViewOptions } from "@latentic/live-markdown";
import { useCallback, useEffect, useRef, useState } from "react";

import { selectFocusedWorkspace } from "../../app/store/activeWorkspace";
import { useWorkspaceLinkTargets } from "../../app/useWorkspaceLinkTargets";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { openExternalUrl } from "../../lib/links/openExternal";
import { markdownToClipboardHtml } from "../../lib/markdown/markdownToClipboardHtml";
import { resolveDisplaySrc } from "../editor/imagePaths";
import { openLargeDocument, type LargeDocumentSession, type LargeDocumentState } from "./largeDocumentSession";
import type { SaveState } from "./pagedSaver";

const OPENING: LargeDocumentState = { status: "opening" };

/** The open file when it is too large to read whole: shown and edited a
 *  window at a time. */
export function LargeDocument() {
  const workspaceId = useWorkspaceStore((state) => selectFocusedWorkspace(state)?.id ?? "");
  const workspacePath = useWorkspaceStore((state) => selectFocusedWorkspace(state)?.path);
  const path = useWorkspaceStore((state) => selectFocusedWorkspace(state)?.activeFilePath ?? "");
  // The file's time on disk as the folder watch last saw it: a change may be
  // another program's.
  const seenOnDisk = useWorkspaceStore((state) => selectFocusedWorkspace(state)?.files.find((entry) => entry.relativePath === path)?.lastModifiedMs);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const linkTargets = useWorkspaceLinkTargets();
  const [state, setState] = useState<LargeDocumentState>(OPENING);
  const pages = useRef<HTMLDivElement>(null);
  const session = useRef<LargeDocumentSession | null>(null);
  // What the view is given when the file opens. The link targets are those
  // of that moment: a note made later is linked to once the file is opened again.
  const viewOptions = useRef<PagedViewOptions>({});
  viewOptions.current = {
    filePath: path,
    workspaceRoot: workspacePath ?? undefined,
    linkTargets,
    onNavigateToLink: (target) => void selectFile(target),
    resolveImageSrc: resolveDisplaySrc,
    onOpenExternalUrl: openExternalUrl,
    renderClipboardHtml: markdownToClipboardHtml,
  };

  useEffect(() => {
    if (!pages.current || !workspaceId || !path) return;
    const opened = openLargeDocument(pages.current, workspaceId, path, viewOptions.current, setState);
    session.current = opened;
    return () => {
      session.current = null;
      opened.dispose();
    };
  }, [workspaceId, path]);

  useEffect(() => session.current?.diskMayHaveChanged(), [seenOnDisk]);

  const keepMine = useCallback(() => session.current?.keepMine(), []);
  const reload = useCallback(() => session.current?.reload(), []);

  return (
    <section className="editor-body large-document" aria-label={path}>
      <LargeDocumentStatus state={state} onKeepMine={keepMine} onReload={reload} />
      <div ref={pages} className="large-document__pages" />
    </section>
  );
}

function LargeDocumentStatus({ state, onKeepMine, onReload }: { state: LargeDocumentState; onKeepMine: () => void; onReload: () => void }) {
  switch (state.status) {
    case "opening":
      // Shown only when the open runs long, as a file still coming down
      // from iCloud does: a file on disk opens before it would appear.
      return <p className="large-document__status large-document__status--slow">Opening…</p>;
    case "failed":
      return (
        <p className="large-document__status" role="alert">
          {state.message}
        </p>
      );
    case "open":
      return <SaveStatus save={state.save} onKeepMine={onKeepMine} onReload={onReload} />;
  }
}

/** Nothing while the file is saved or being saved; a line when the user has
 *  something to decide or to know. */
function SaveStatus({ save, onKeepMine, onReload }: { save: SaveState; onKeepMine: () => void; onReload: () => void }) {
  if (save.status === "conflict") {
    return (
      <p className="large-document__status large-document__status--alert" role="alert">
        Another program changed this file. Your edits are not saved.
        <button type="button" className="large-document__action" onClick={onKeepMine}>
          Keep my version
        </button>
        <button type="button" className="large-document__action" onClick={onReload}>
          Use the version on disk
        </button>
      </p>
    );
  }
  if (save.status === "failed") {
    return (
      <p className="large-document__status large-document__status--alert" role="alert">
        Not saved: {save.message}
      </p>
    );
  }
  return null;
}
