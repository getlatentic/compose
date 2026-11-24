import { FileConflictError } from "../../lib/workspace/fileErrors";

/** Where a large file's edits are. */
export type SaveState =
  | { status: "saved" }
  | { status: "edited" }
  | { status: "saving" }
  /** Another program changed the file: nothing is written until the user
   *  says which text to keep. */
  | { status: "conflict" }
  | { status: "failed"; message: string };

export interface PagedSaverOptions {
  /** Resolves when every edit made so far is at the backend. */
  sent(): Promise<void>;
  save(overChanges: boolean): Promise<void>;
  /** How long after the last edit the file is written. */
  delayMs: number;
  onState(state: SaveState): void;
}

export interface PagedSaver {
  /** The user edited the text. */
  edited(): void;
  /** Writes the file now if it has edits, and resolves when it is written
   *  or could not be. */
  saveNow(): Promise<void>;
  /** Writes the file over what another program put there. */
  keepMine(): Promise<void>;
  /** Another program changed the file while it had edits here. */
  conflicted(): void;
  /** No edit is waiting to be written. */
  isClean(): boolean;
  dispose(): void;
}

/** A save rewrites the whole file, so a longer file is saved less often:
 *  a second after the last edit up to 50 MB, two minutes at 6 GB and over. */
export function autosaveDelayMs(sizeBytes: number): number {
  return Math.min(120_000, Math.max(1_000, Math.round(sizeBytes / 50_000)));
}

/** Writes a large file some time after its last edit, one write at a time. */
export function createPagedSaver({ sent, save, delayMs, onState }: PagedSaverOptions): PagedSaver {
  let edits = false;
  let conflict = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> | null = null;

  const stopTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  /** One write. Edits made while it runs stay marked, and are written by
   *  the next. */
  async function write(overChanges: boolean): Promise<void> {
    edits = false;
    onState({ status: "saving" });
    try {
      await sent();
      await save(overChanges);
      conflict = false;
      onState(edits ? { status: "edited" } : { status: "saved" });
    } catch (error) {
      edits = true;
      conflict = error instanceof FileConflictError;
      onState(conflict ? { status: "conflict" } : { status: "failed", message: error instanceof Error ? error.message : "Could not save the file" });
    }
  }

  function written(overChanges: boolean): Promise<void> {
    stopTimer();
    const after = writing ?? Promise.resolve();
    const next: Promise<void> = after.then(() => write(overChanges)).finally(() => {
      if (writing === next) writing = null;
    });
    writing = next;
    return next;
  }

  return {
    edited() {
      edits = true;
      if (conflict) return;
      if (writing === null) onState({ status: "edited" });
      stopTimer();
      timer = setTimeout(() => void written(false), delayMs);
    },
    async saveNow() {
      if (writing !== null) await writing;
      if (edits && !conflict) await written(false);
    },
    keepMine: () => written(true),
    conflicted() {
      stopTimer();
      conflict = true;
      onState({ status: "conflict" });
    },
    isClean: () => !edits && writing === null,
    dispose: stopTimer,
  };
}
