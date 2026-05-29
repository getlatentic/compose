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
