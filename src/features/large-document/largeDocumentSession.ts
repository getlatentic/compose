import { createPagedMarkdownView, type PagedMarkdownView, type PagedViewOptions } from "@latentic/live-markdown";

import { registerLargeDocumentSave } from "../../lib/editor/largeDocumentSaves";
import { openPagedFile, type OpenedPagedFile } from "../../lib/ipc/pagedClient";
import { autosaveDelayMs, createPagedSaver, type PagedSaver, type SaveState } from "./pagedSaver";

/** A large file on screen. */
export type LargeDocumentState =
  | { status: "opening" }
  | { status: "failed"; message: string }
  | { status: "open"; save: SaveState };

export interface LargeDocumentSession {
  /** Writes the user's text over what another program put in the file. */
  keepMine(): void;
  /** Shows the file as it is on disk, dropping the edits not saved. */
  reload(): void;
  /** The file may have been changed by another program: with no edits here
   *  it is shown again, with edits the user is asked. */
  diskMayHaveChanged(): void;
  /** Saves, then lets go of the file. */
  dispose(): void;
}

/** The file, the view on it, and the saving of it: made and let go together. */
interface Shown {
  file: OpenedPagedFile;
  view: PagedMarkdownView;
  saver: PagedSaver;
  unregister(): void;
}

const messageOf = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

/**
 * Shows the large file at `relativePath` in `parent`: opens it without
 * reading it, lets the user edit it a window at a time, and writes it some
 * time after each run of edits.
 */
export function openLargeDocument(
  parent: HTMLElement,
  workspaceId: string,
  relativePath: string,
  viewOptions: PagedViewOptions,
  onState: (state: LargeDocumentState) => void,
): LargeDocumentSession {
  let shown: Shown | null = null;
  let disposed = false;
  /** The byte of the file at the top of the page, kept across a reload. */
  let top = 0;
  /** Each open and each close waits for the one before: the backend is
   *  never asked to open a file it is still closing. */
  let work: Promise<void> = Promise.resolve();

  const report = (save: SaveState): void => {
    if (!disposed) onState({ status: "open", save });
  };

  async function show(): Promise<void> {
    if (disposed) return;
    onState({ status: "opening" });
    const file = await openPagedFile(workspaceId, relativePath);
    if (disposed) return file.close();
    const saver = createPagedSaver({ sent: () => view.sent(), save: file.save, delayMs: autosaveDelayMs(file.source.size), onState: report });
    const view = createPagedMarkdownView(parent, file.source, {
      ...viewOptions,
      onMove: (byte) => (top = byte),
      onEdit: saver.edited,
      onEditFailed: (error) => report({ status: "failed", message: messageOf(error, "An edit could not be made") }),
    });
    shown = { file, view, saver, unregister: registerLargeDocumentSave(saver.saveNow) };
    report({ status: "saved" });
    if (top > 0) await view.jumpTo(top);
  }

  /** Takes the file off the screen. Its edits are saved first, unless they
   *  are being dropped. The view goes as soon as its edits are at the
   *  backend: the write of a long file is not waited for with it on screen. */
  async function hide(discard: boolean): Promise<void> {
    const leaving = shown;
    shown = null;
    if (!leaving) return;
    leaving.saver.dispose();
    try {
      if (!discard) await leaving.view.sent();
    } finally {
      leaving.view.destroy();
    }
    try {
      if (!discard) await leaving.saver.saveNow();
    } finally {
      leaving.unregister();
      await leaving.file.close(discard);
    }
  }

  const then = (task: () => Promise<void>): void => {
    work = work.then(task).catch((error: unknown) => {
      if (!disposed) onState({ status: "failed", message: messageOf(error, "Could not open the file") });
    });
  };

  then(show);

  return {
    keepMine: () => void shown?.saver.keepMine(),
    reload: () => then(() => hide(true).then(show)),
    diskMayHaveChanged: () =>
      then(async () => {
        if (!shown || !(await shown.file.changedOnDisk())) return;
        if (!shown.saver.isClean()) return shown.saver.conflicted();
        await hide(true);
        await show();
      }),
    dispose: () => {
      disposed = true;
      then(() => hide(false));
    },
  };
}
