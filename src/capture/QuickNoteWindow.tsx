import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";

import type { CaptureApi, QuickNoteView } from "./captureApi";
import { ClipboardView, type ClipboardActions } from "./clipboard/ClipboardView";
import { entryMarkdown } from "./clipboard/entryMarkdown";
import { useClipboardHistory } from "./clipboard/useClipboardHistory";
import { NotesView } from "./notes/NotesView";
import { useQuickNotes } from "./notes/useQuickNotes";
import { useWindowKeys } from "./useWindowKeys";

/**
 * The quick-note window: the notes jotted in it, each kept until saved into the
 * workspace, and the clipboard history, whose entries paste again anywhere or
 * go into a note. Opens over any app on a shortcut; Esc puts it away.
 */
export function QuickNoteWindow({ api }: { api: CaptureApi }) {
  const [view, setView] = useState<QuickNoteView>("notes");
  const [destination, setDestination] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const notes = useQuickNotes(api);
  const history = useClipboardHistory(api.clipboard);
  const showing = useRef(view);
  showing.current = view;
  const editor = useRef<{ view: EditorView; noteId: string } | null>(null);
  // Waits for a note's editor to open: a new note is only on screen a render later.
  const whenOpen = useRef<{ noteId: string; act(view: EditorView): void } | null>(null);
  const search = useRef<HTMLInputElement>(null);

  /** Whenever the note being written changes, typing goes on in it. */
  const onView = useCallback((next: EditorView | null, noteId: string) => {
    if (!next) {
      if (editor.current?.noteId === noteId) editor.current = null;
      return;
    }
    editor.current = { view: next, noteId };
    if (showing.current === "notes") next.focus();
    const waiting = whenOpen.current;
    if (waiting?.noteId !== noteId) return;
    whenOpen.current = null;
    waiting.act(next);
  }, []);

  /** Does `act` in a note's editor: now when it is open, else as soon as it opens. */
  const inEditor = useCallback((noteId: string, act: (view: EditorView) => void) => {
    const open = editor.current;
    if (open?.noteId === noteId) act(open.view);
    else whenOpen.current = { noteId, act };
  }, []);

  const focusView = useCallback((shown: QuickNoteView) => {
    requestAnimationFrame(() => {
      if (shown === "clipboard") {
        search.current?.focus();
        return;
      }
      editor.current?.view.requestMeasure();
      editor.current?.view.focus();
    });
  }, []);

  const { openOnNewest } = history;
  const show = useCallback(
    (shown: QuickNoteView) => {
      setView(shown);
      if (shown === "clipboard") openOnNewest();
      focusView(shown);
    },
    [focusView, openOnNewest],
  );

  useEffect(() => {
    const refreshDestination = () => api.destination().then(setDestination, () => setDestination(null));
    void refreshDestination();
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    api
      .onShown((shown) => {
        show(shown);
        void refreshDestination();
      })
      .then(
        (stop) => {
          if (cancelled) stop();
          else unlisten = stop;
        },
        () => undefined,
      );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [api, show]);

  const keepNotes = notes.flush;

  useEffect(() => {
    const onBlur = () => void keepNotes();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [keepNotes]);

  const close = useCallback(async () => {
    await keepNotes();
    await api.close();
  }, [api, keepNotes]);

  const save = useCallback(async () => {
    const active = notes.active;
    if (!active || saving) return;
    setSaving(true);
    await notes.save(active.id);
    setSaving(false);
  }, [notes, saving]);

  const newNote = useCallback(() => {
    inEditor(notes.create().id, (view) => view.focus());
  }, [inEditor, notes]);

  /** What was picked, oldest copy first, which is the order a note gathers them in. */
  const inCopyOrder = useCallback(
    (ids: string[]) => {
      const picked = new Set(ids);
      return history.items
        .filter((item) => picked.has(item.id))
        .sort((one, other) => one.copiedAt - other.copiedAt)
        .map((item) => item.id);
    },
    [history.items],
  );

  const insertInto = useCallback(
    async (noteId: string, entryIds: string[]) => {
      const parts: string[] = [];
      let block = false;
      for (const entryId of entryIds) {
        const entry = await api.clipboard.entry(entryId);
        if (!entry) continue;
        const markdown = await entryMarkdown(entry, (relativePath, bytes) => api.keepImage(noteId, relativePath, bytes));
        if (!markdown) continue;
        block ||= entry.kind === "image";
        parts.push(markdown);
      }
      const open = editor.current;
      if (parts.length === 0 || open?.noteId !== noteId) return;
      const { view } = open;
      const { from } = view.state.selection.main;
      // An image, and a gathering of several, start a line of their own rather
      // than running on from what is already written.
      const ownLine = (block || parts.length > 1) && from > view.state.doc.lineAt(from).from;
      const markdown = parts.join("\n\n");
      view.dispatch(view.state.replaceSelection(ownLine ? `\n${markdown}` : markdown));
      view.focus();
    },
    [api],
  );

  const actions: ClipboardActions = useMemo(
    () => ({
      use: (ids) =>
        void (async () => {
          await api.clipboard.copy(inCopyOrder(ids));
          await close();
        })(),
      insert: (ids) => {
        const active = notes.active;
        if (!active) return;
        show("notes");
        void insertInto(active.id, inCopyOrder(ids));
      },
      newNote: (ids) => {
        const note = notes.create();
        show("notes");
        inEditor(note.id, () => void insertInto(note.id, inCopyOrder(ids)));
      },
    }),
    [api, close, inCopyOrder, inEditor, insertInto, notes, show],
  );

  useWindowKeys({
    view,
    close: () => void close(),
    save: () => void save(),
    newNote: () => {
      if (view === "clipboard" && history.selectedIds.length > 0) actions.newNote(history.selectedIds);
      else if (view === "notes") newNote();
    },
    insertClip: () => {
      if (history.selectedIds.length > 0) actions.insert(history.selectedIds);
    },
    pinClip: () => {
      const picked = history.items.filter((item) => history.selectedIds.includes(item.id));
      if (picked.length === 0) return;
      // Pinning a gathering pins all of it, unless all of it is pinned already.
      const pinned = picked.some((item) => !item.pinned);
      void history.pin(
        picked.map((item) => item.id),
        pinned,
      );
    },
    switchView: () => show(view === "notes" ? "clipboard" : "notes"),
    stepNote: (step) => {
      const index = notes.notes.findIndex((note) => note.id === notes.active?.id);
      const next = notes.notes[index + step];
      if (next) notes.select(next.id);
    },
  });

  const showNotes = useCallback(() => show("notes"), [show]);
  const showClipboard = useCallback(() => show("clipboard"), [show]);

  return (
    <main className="quick-note">
      <header className="quick-note__bar" data-tauri-drag-region>
        <div className="quick-note__tabs" role="tablist" aria-label="Quick note">
          <button type="button" role="tab" aria-selected={view === "notes"} className="quick-note__tab" onClick={showNotes}>
            Notes
            {notes.notes.length > 1 ? <span className="quick-note__count">{notes.notes.length}</span> : null}
          </button>
          <button type="button" role="tab" aria-selected={view === "clipboard"} className="quick-note__tab" onClick={showClipboard}>
            Clipboard
          </button>
        </div>
        <span className="quick-note__destination" data-tauri-drag-region>
          {destination ? `Saves to ${destination}` : "Open a workspace in Compose to save notes"}
        </span>
      </header>
      <div className="quick-note__view" hidden={view !== "notes"}>
        <NotesView
          api={api}
          notes={notes}
          saving={saving}
          onView={onView}
          onNewNote={newNote}
          onSave={save}
          onClose={close}
        />
      </div>
      <div className="quick-note__view" hidden={view !== "clipboard"}>
        <ClipboardView api={api} history={history} actions={actions} searchRef={search} />
      </div>
    </main>
  );
}
