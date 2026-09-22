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
  const editor = useRef<EditorView | null>(null);
  const flushEditor = useRef<(() => void) | null>(null);
  const search = useRef<HTMLInputElement>(null);
  // A note made from an image waits for its editor before the image goes in.
  const [pendingInsert, setPendingInsert] = useState<{ noteId: string; entryId: string } | null>(null);

  const onView = useCallback((next: EditorView | null) => {
    editor.current = next;
  }, []);
  const onFlush = useCallback((flush: (() => void) | null) => {
    flushEditor.current = flush;
  }, []);

  const focusView = useCallback((shown: QuickNoteView) => {
    requestAnimationFrame(() => {
      if (shown === "clipboard") {
        search.current?.focus();
        return;
      }
      editor.current?.requestMeasure();
      editor.current?.focus();
    });
  }, []);

  const show = useCallback(
    (shown: QuickNoteView) => {
      setView(shown);
      focusView(shown);
    },
    [focusView],
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
        if (shown === "clipboard") void history.refresh();
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
  }, [api, show, history.refresh]);

  const keepEverything = useCallback(async () => {
    flushEditor.current?.();
    await notes.flush();
  }, [notes]);

  useEffect(() => {
    const onBlur = () => void keepEverything();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [keepEverything]);

  const close = useCallback(async () => {
    await keepEverything();
    await api.close();
  }, [api, keepEverything]);

  const save = useCallback(async () => {
    const active = notes.active;
    if (!active || saving) return;
    flushEditor.current?.();
    setSaving(true);
    await notes.save(active.id, editor.current?.state.doc.toString());
    setSaving(false);
  }, [notes, saving]);

  const insertInto = useCallback(
    async (noteId: string, entryId: string) => {
      const entry = await api.clipboard.entry(entryId);
      const view = editor.current;
      if (!entry || !view) return;
      const markdown = await entryMarkdown(entry, (relativePath, bytes) => api.keepImage(noteId, relativePath, bytes));
      const { from } = view.state.selection.main;
      const onOwnLine = entry.kind === "image" && from > view.state.doc.lineAt(from).from;
      view.dispatch(view.state.replaceSelection(onOwnLine ? `\n${markdown}` : markdown));
      view.focus();
    },
    [api],
  );

  const actions: ClipboardActions = useMemo(
    () => ({
      use: (id) =>
        void (async () => {
          await api.clipboard.copy(id);
          await close();
        })(),
      insert: (id) => {
        const active = notes.active;
        if (!active) return;
        show("notes");
        void insertInto(active.id, id);
      },
      newNote: (id) => {
        const note = notes.create();
        show("notes");
        setPendingInsert({ noteId: note.id, entryId: id });
      },
    }),
    [api, close, insertInto, notes, show],
  );

  useEffect(() => {
    if (!pendingInsert || notes.active?.id !== pendingInsert.noteId) return;
    // The new note's editor mounts on the next frame.
    const frame = requestAnimationFrame(() => {
      setPendingInsert(null);
      void insertInto(pendingInsert.noteId, pendingInsert.entryId);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingInsert, notes.active, insertInto]);

  useWindowKeys({
    view,
    close: () => void close(),
    save: () => void save(),
    newNote: () => {
      if (view === "clipboard" && history.selectedId) actions.newNote(history.selectedId);
      else if (view === "notes") notes.create();
    },
    insertClip: () => {
      if (history.selectedId) actions.insert(history.selectedId);
    },
    pinClip: () => {
      const selected = history.items.find((item) => item.id === history.selectedId);
      if (selected) void history.pin(selected.id, !selected.pinned);
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
        <NotesView api={api} notes={notes} saving={saving} onView={onView} onFlush={onFlush} onSave={save} onClose={close} />
      </div>
      <div className="quick-note__view" hidden={view !== "clipboard"}>
        <ClipboardView api={api} history={history} actions={actions} searchRef={search} />
      </div>
    </main>
  );
}
