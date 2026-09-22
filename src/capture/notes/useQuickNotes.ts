import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CaptureApi, QuickNote } from "../captureApi";

/** Where the quick-note window kept its one draft before it held several. */
const OLD_DRAFT_KEY = "compose.captureDraft.v1";
/** A pause in typing this long keeps what was typed. */
const KEEP_AFTER_MS = 400;

export interface QuickNotes {
  /** Newest first. The first may be a blank note not kept yet. */
  notes: QuickNote[];
  active: QuickNote | null;
  loaded: boolean;
  error: string | null;
  select(id: string): void;
  /** A new note, made the active one; a blank one reuses the blank already there. */
  create(body?: string): QuickNote;
  edit(id: string, body: string): void;
  remove(id: string): Promise<void>;
  /**
   * Saves the note into the workspace. `body` is the editor's text when it may
   * be ahead of the last change reported. `false` when blank or the save failed.
   */
  save(id: string, body?: string): Promise<boolean>;
  /** Keeps whatever is still waiting for a pause in typing. */
  flush(): Promise<void>;
  /** Whether a note has text, counting what was typed a moment ago. */
  hasText(id: string): boolean;
  /**
   * The editor's way to hand over what was typed since its last report, which
   * it would drop on closing; `null` once it is gone.
   */
  onEditorFlush(flush: (() => void) | null): void;
  dismissError(): void;
}

export function useQuickNotes(api: CaptureApi): QuickNotes {
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kept = useRef(new Set<string>());
  const waiting = useRef(new Map<string, { body: string; timer: ReturnType<typeof setTimeout> }>());
  // A keep still on its way would bring a note back after it was saved or deleted.
  const inFlight = useRef(new Map<string, Promise<void>>());
  const current = useRef(notes);
  current.current = notes;
  // The editor reports typing only after a pause; this takes it now.
  const editorFlush = useRef<(() => void) | null>(null);
  const takeTyped = useCallback(() => editorFlush.current?.(), []);

  const fail = useCallback((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)), []);

  useEffect(() => {
    let cancelled = false;
    loadNotes(api).then(
      (list) => {
        if (cancelled) return;
        for (const note of list) kept.current.add(note.id);
        const initial = list.length > 0 ? list : [blankNote()];
        setNotes(initial);
        setActiveId(initial[0]?.id ?? null);
        setLoaded(true);
      },
      (caught) => {
        if (cancelled) return;
        const initial = [blankNote()];
        setNotes(initial);
        setActiveId(initial[0]?.id ?? null);
        setLoaded(true);
        fail(caught);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, fail]);

  const keepNow = useCallback(
    async (id: string) => {
      const entry = waiting.current.get(id);
      if (!entry) return inFlight.current.get(id);
      clearTimeout(entry.timer);
      waiting.current.delete(id);
      const keeping = (inFlight.current.get(id) ?? Promise.resolve())
        .then(() => api.keepNote(id, entry.body))
        .then(
          () => void kept.current.add(id),
          (caught: unknown) => fail(caught),
        )
        .finally(() => {
          if (inFlight.current.get(id) === keeping) inFlight.current.delete(id);
        });
      inFlight.current.set(id, keeping);
      return keeping;
    },
    [api, fail],
  );

  const edit = useCallback(
    (id: string, body: string) => {
      setNotes((list) => list.map((note) => (note.id === id ? { ...note, body, updatedAt: Date.now() } : note)));
      const previous = waiting.current.get(id);
      if (previous) clearTimeout(previous.timer);
      if (!body && !kept.current.has(id)) {
        waiting.current.delete(id);
        return;
      }
      waiting.current.set(id, { body, timer: setTimeout(() => void keepNow(id), KEEP_AFTER_MS) });
    },
    [keepNow],
  );

  const flush = useCallback(async () => {
    takeTyped();
    await Promise.all([...waiting.current.keys()].map((id) => keepNow(id)));
  }, [keepNow, takeTyped]);

  /** A note's text as last typed, which can be ahead of the render showing it. */
  const latestBody = useCallback(
    (id: string) => waiting.current.get(id)?.body ?? current.current.find((note) => note.id === id)?.body ?? "",
    [],
  );

  const hasText = useCallback(
    (id: string) => {
      takeTyped();
      return latestBody(id).trim() !== "";
    },
    [latestBody, takeTyped],
  );

  const select = useCallback(
    (id: string) => {
      takeTyped();
      setActiveId(id);
    },
    [takeTyped],
  );

  const create = useCallback(
    (body = "") => {
      takeTyped();
      const blank = current.current.find((note) => !kept.current.has(note.id) && !latestBody(note.id));
      if (blank && !body) {
        setActiveId(blank.id);
        return blank;
      }
      const note = blankNote(body);
      setNotes((list) => [note, ...list.filter((each) => each !== blank)]);
      setActiveId(note.id);
      if (body) edit(note.id, body);
      return note;
    },
    [edit, latestBody, takeTyped],
  );

  const drop = useCallback((id: string) => {
    const pending = waiting.current.get(id);
    if (pending) clearTimeout(pending.timer);
    waiting.current.delete(id);
    kept.current.delete(id);
    const list = current.current;
    const index = list.findIndex((note) => note.id === id);
    const rest = list.filter((note) => note.id !== id);
    const remaining = rest.length > 0 ? rest : [blankNote()];
    setNotes(remaining);
    setActiveId((active) => (active === id ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? null) : active));
  }, []);

  const settle = useCallback(async (id: string) => {
    const pending = waiting.current.get(id);
    if (pending) clearTimeout(pending.timer);
    waiting.current.delete(id);
    await inFlight.current.get(id);
  }, []);

  const remove = useCallback(
    async (id: string) => {
      try {
        await settle(id);
        if (kept.current.has(id)) await api.deleteNote(id);
        drop(id);
      } catch (caught) {
        fail(caught);
      }
    },
    [api, drop, fail, settle],
  );

  const save = useCallback(
    async (id: string, body?: string) => {
      takeTyped();
      const text = body ?? latestBody(id);
      if (!text.trim()) return false;
      try {
        await settle(id);
        const saved = await api.save(id, text);
        if (saved) drop(id);
        return saved;
      } catch (caught) {
        fail(caught);
        return false;
      }
    },
    [api, drop, fail, latestBody, settle, takeTyped],
  );

  const onEditorFlush = useCallback((flush: (() => void) | null) => {
    editorFlush.current = flush;
  }, []);

  const active = useMemo(() => notes.find((note) => note.id === activeId) ?? notes[0] ?? null, [notes, activeId]);
  const dismissError = useCallback(() => setError(null), []);

  return { notes, active, loaded, error, select, create, edit, remove, save, flush, hasText, onEditorFlush, dismissError };
}

/** The notes the app has, with the old single draft moved in as one of them. */
async function loadNotes(api: CaptureApi): Promise<QuickNote[]> {
  const list = await api.notes();
  const draft = readOldDraft();
  if (!draft) return list;
  const moved = await api.keepNote(newId(), draft);
  forgetOldDraft();
  return [moved, ...list];
}

function blankNote(body = ""): QuickNote {
  const now = Date.now();
  return { id: newId(), body, createdAt: now, updatedAt: now };
}

function newId(): string {
  return crypto.randomUUID();
}

function readOldDraft(): string {
  try {
    return localStorage.getItem(OLD_DRAFT_KEY)?.trim() ? (localStorage.getItem(OLD_DRAFT_KEY) ?? "") : "";
  } catch {
    return "";
  }
}

function forgetOldDraft(): void {
  try {
    localStorage.removeItem(OLD_DRAFT_KEY);
  } catch {
    // Storage unavailable: nothing was read from it either.
  }
}
