/**
 * The large files on screen, as the app's save-on-exit sees them. A large
 * file has no buffer in the store: its text is in the backend, and the
 * screen showing it knows how to save it.
 */

type Save = () => Promise<void>;

const open = new Set<Save>();

/** Called by a large file's screen when it opens. Returns how to take it
 *  out again. */
export function registerLargeDocumentSave(save: Save): () => void {
  open.add(save);
  return () => void open.delete(save);
}

/** Saves every large file on screen. One that fails does not keep the
 *  others from saving, or the app from closing. */
export async function saveLargeDocuments(): Promise<void> {
  await Promise.allSettled([...open].map((save) => save()));
}
