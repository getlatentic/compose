import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import type { CaptureApi } from "./captureApi";

/** Where an unsaved capture waits: the window is hidden, not closed, but a
 *  restart should not lose it either. */
const DRAFT_KEY = "compose.captureDraft.v1";

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

/** A click on Save or Close leaves the caret where it was, so a failed save
 *  can be fixed without clicking back into the text. */
function keepTheCaret(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

function writeDraft(text: string): void {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private mode or full storage: the draft lives only as long as the window.
  }
}

/**
 * The quick-capture window: type an idea, then Save (⌘↩) makes it a note and
 * Close (Esc) puts it away. Whatever is left unsaved is there next time the
 * shortcut opens it.
 */
export function QuickCapture({ api }: { api: CaptureApi }) {
  const [text, setText] = useState(readDraft);
  const [destination, setDestination] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const takeKeyboard = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    setError(null);
    void api.destination().then(setDestination, () => setDestination(null));
  }, [api]);

  useEffect(
    function takeKeyboardWhenShown() {
      takeKeyboard();
      let stop: (() => void) | null = null;
      let unmounted = false;
      void api.onShown(takeKeyboard).then((unlisten) => {
        if (unmounted) unlisten();
        else stop = unlisten;
      });
      return () => {
        unmounted = true;
        stop?.();
      };
    },
    [api, takeKeyboard],
  );

  useEffect(() => writeDraft(text), [text]);

  const save = useCallback(async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      if (await api.save(text)) setText("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  }, [api, saving, text]);

  const close = useCallback(() => {
    void api.close();
  }, [api]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void save();
      }
    },
    [close, save],
  );

  const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
  }, []);

  return (
    <main className="quick-capture">
      <header className="quick-capture__bar" data-tauri-drag-region>
        <span className="quick-capture__title" data-tauri-drag-region>
          Quick note
        </span>
        <span className="quick-capture__destination" data-tauri-drag-region>
          {destination ? `Saves to ${destination}` : "Open a workspace in Compose to save notes"}
        </span>
      </header>
      <textarea
        ref={editorRef}
        className="quick-capture__editor"
        aria-label="Quick note"
        placeholder="Type an idea…"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        spellCheck
      />
      <footer className="quick-capture__footer">
        {error ? (
          <span role="alert" className="quick-capture__error">
            {error}
          </span>
        ) : null}
        <button
          type="button"
          className="quick-capture__action"
          aria-keyshortcuts="Meta+Enter"
          disabled={saving || !text.trim()}
          onMouseDown={keepTheCaret}
          onClick={save}
        >
          <kbd>⌘↩</kbd> Save
        </button>
        <button
          type="button"
          className="quick-capture__action"
          aria-keyshortcuts="Escape"
          onMouseDown={keepTheCaret}
          onClick={close}
        >
          <kbd>Esc</kbd> Close
        </button>
      </footer>
    </main>
  );
}
