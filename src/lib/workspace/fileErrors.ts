/**
 * Shared file-operation error type, used by both the Tauri path and the
 * browser virtual-workspace path in `filesClient`. Lives in its own module
 * so `filesClient` and `virtualWorkspace` can both depend on it without a
 * cycle.
 */
export class FileConflictError extends Error {
  constructor(public readonly latestLastModifiedMs: number) {
    super("File changed on disk");
    this.name = "FileConflictError";
  }
}

/** The file does not exist — an authoritative "gone", as opposed to a
 *  transient read failure (permissions, an evicted iCloud copy, a hiccup). */
export class FileNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileNotFoundError";
  }
}

/** The file is over the size that is read whole. It is shown a window at a
 *  time instead (`pagedClient`). */
export class FileTooLargeError extends Error {
  constructor(public readonly sizeBytes: number) {
    super("File is too large to read whole");
    this.name = "FileTooLargeError";
  }
}
