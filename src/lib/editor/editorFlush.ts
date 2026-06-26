/**
 * Bridge between the editor (React/CodeMirror) and the store's save path.
 *
 * The editor debounces its buffer update by 500ms (so typing doesn't fire
 * a store write — and re-render — on every keystroke). That means the
 * in-memory buffer LAGS the live editor by up to 500ms. Anything that
 * reads the buffer to persist it — `saveActiveFile` (Cmd+S / autosave),
 * tab switch, app close — must first pull the editor's live content into
 * the buffer, or it writes stale data (confirmed data-loss bug).
 *
 * The active editor registers a synchronous `flush` here on mount; the
 * store calls `flushActiveEditor()` before reading the buffer. The flush
 * cancels the pending debounce and writes the live content into the
 * buffer immediately, so the subsequent buffer read sees current text.
 */

type FlushFn = () => void;

let activeFlush: FlushFn | null = null;

/** Called by the editor on mount; pass `null` on unmount. */
export function registerActiveEditorFlush(fn: FlushFn | null): void {
  activeFlush = fn;
}

/** Pull the active editor's live content into the buffer, synchronously. */
export function flushActiveEditor(): void {
  activeFlush?.();
}
