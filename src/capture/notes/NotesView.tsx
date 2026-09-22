import { useCallback, useState, type MouseEvent } from "react";
import type { EditorView } from "@codemirror/view";
import type { CaptureApi } from "../captureApi";
import { PlusIcon } from "../icons";
import { timeAgo } from "../timeAgo";
import { NoteEditor } from "./NoteEditor";
import { noteTitle } from "./noteTitle";
import type { QuickNotes } from "./useQuickNotes";

export interface NotesViewProps {
  api: CaptureApi;
  notes: QuickNotes;
  saving: boolean;
  onView(view: EditorView | null): void;
  onFlush(flush: (() => void) | null): void;
  onSave(): void;
  onClose(): void;
}

/** The quick notes: the list, the one being written, and what to do with it. */
export function NotesView({ api, notes, saving, onView, onFlush, onSave, onClose }: NotesViewProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const active = notes.active;

  const selectNote = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const id = event.currentTarget.dataset.id;
      if (id) notes.select(id);
      setConfirmingDelete(false);
    },
    [notes],
  );
  const newNote = useCallback(() => {
    notes.create();
    setConfirmingDelete(false);
  }, [notes]);
  const askToDelete = useCallback(() => {
    if (!active) return;
    if (active.body.trim()) setConfirmingDelete(true);
    else void notes.remove(active.id);
  }, [active, notes]);
  const confirmDelete = useCallback(() => {
    setConfirmingDelete(false);
    if (active) void notes.remove(active.id);
  }, [active, notes]);
  const keepNote = useCallback(() => setConfirmingDelete(false), []);

  return (
    <div className="quick-note__notes">
      <nav className="quick-note__list" aria-label="Quick notes">
        <button type="button" className="quick-note__new" onMouseDown={keepTheCaret} onClick={newNote}>
          <PlusIcon />
          <span>New note</span>
          <kbd>⌘N</kbd>
        </button>
        <ul>
          {notes.notes.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                className="quick-note__list-item"
                aria-current={note.id === active?.id ? "true" : undefined}
                data-id={note.id}
                onClick={selectNote}
              >
                <span className="quick-note__list-title">{noteTitle(note.body) || "New note"}</span>
                <span className="quick-note__list-time">{timeAgo(note.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className="quick-note__editor" aria-label="Quick note">
        {active ? (
          <NoteEditor key={active.id} api={api} note={active} onChange={notes.edit} onView={onView} onFlush={onFlush} />
        ) : null}
      </section>
      <footer className="quick-note__footer">
        {notes.error ? (
          <span role="alert" className="quick-note__error">
            {notes.error}
            <button type="button" className="quick-note__link" onClick={notes.dismissError}>
              Dismiss
            </button>
          </span>
        ) : null}
        {confirmingDelete ? (
          <span role="alert" className="quick-note__confirm">
            Delete this note? It has not been saved.
            <button type="button" className="quick-note__action quick-note__action--danger" onClick={confirmDelete}>
              Delete
            </button>
            <button type="button" className="quick-note__action" onClick={keepNote}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className="quick-note__action quick-note__action--quiet" onMouseDown={keepTheCaret} onClick={askToDelete}>
            Delete
          </button>
        )}
        <span className="quick-note__spacer" />
        <button
          type="button"
          className="quick-note__action quick-note__action--primary"
          aria-keyshortcuts="Meta+Enter"
          disabled={saving || !active?.body.trim()}
          onMouseDown={keepTheCaret}
          onClick={onSave}
        >
          <kbd>⌘↩</kbd> Save
        </button>
        <button type="button" className="quick-note__action" aria-keyshortcuts="Escape" onMouseDown={keepTheCaret} onClick={onClose}>
          <kbd>Esc</kbd> Close
        </button>
      </footer>
    </div>
  );
}

/** A click on a button leaves the caret where it was, so typing carries on. */
function keepTheCaret(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}
