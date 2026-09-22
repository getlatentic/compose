import { useCallback, useEffect, useRef, useState } from "react";

import type { ClipboardAccess, ClipboardApi, ClipboardSummary } from "../captureApi";

/** Typing in the search box asks again after this pause. */
const SEARCH_AFTER_MS = 120;

export interface ClipboardHistoryState {
  /** `null` until the app has said. */
  enabled: boolean | null;
  access: ClipboardAccess;
  items: ClipboardSummary[];
  query: string;
  /** What the actions work on, in the order the list shows it: the newest copy, until the user picks. */
  selectedIds: string[];
  /** The entry the keyboard sits on, which the arrows move from. */
  focusId: string | null;
  error: string | null;
  setQuery(query: string): void;
  /** Pick one entry, on its own. */
  select(id: string): void;
  /** Take an entry into what is picked, or out of it again. */
  toggle(id: string): void;
  /** Pick every entry between the one the picking started at and this one. */
  extendTo(id: string): void;
  /** Move the keyboard by `step` entries and pick that one alone. */
  move(step: number): void;
  /** Take the entry `step` away into what is picked, as shift and an arrow do. */
  extend(step: number): void;
  /** Clear the search and go back to the newest copy, as the view is each time it is shown. */
  openOnNewest(): void;
  refresh(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  pin(ids: string[], pinned: boolean): Promise<void>;
  forget(id: string): Promise<void>;
  clear(): Promise<void>;
  openPrivacySettings(): Promise<void>;
}

export function useClipboardHistory(api: ClipboardApi): ClipboardHistoryState {
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const [access, setAccess] = useState<ClipboardAccess>("allowed");
  const [items, setItems] = useState<ClipboardSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  // Keeps the selection on the newest copy as copies arrive, so Return pastes the latest.
  const onNewest = useRef(true);
  // The list and the keyboard's place in it, for callbacks that outlive a render.
  const shown = useRef(items);
  shown.current = items;
  const focus = useRef(focusId);
  focus.current = focusId;
  /** Where a run of picking started, which shift-picking reaches back to. */
  const anchor = useRef<string | null>(null);

  /** `ids` in the order the list shows them. */
  const inListOrder = useCallback((ids: Iterable<string>) => {
    const wanted = new Set(ids);
    return shown.current.filter((item) => wanted.has(item.id)).map((item) => item.id);
  }, []);

  const pickOne = useCallback((id: string | null) => {
    onNewest.current = false;
    anchor.current = id;
    setFocusId(id);
    setSelectedIds(id === null ? [] : [id]);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const history = await api.history(queryRef.current);
      setEnabledState(history.enabled);
      setAccess(history.access);
      setItems(history.items);
      const newest = newestId(history.items);
      setSelectedIds((picked) => {
        const kept = onNewest.current ? [] : picked.filter((id) => history.items.some((item) => item.id === id));
        return kept.length > 0 ? kept : newest === null ? [] : [newest];
      });
      setFocusId((current) =>
        !onNewest.current && current && history.items.some((item) => item.id === current) ? current : newest,
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [api]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), query ? SEARCH_AFTER_MS : 0);
    return () => clearTimeout(timer);
  }, [query, refresh]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    api.onChanged(() => void refresh()).then(
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
  }, [api, refresh]);

  const search = useCallback((next: string) => {
    onNewest.current = true;
    setQuery(next);
  }, []);

  const toggle = useCallback(
    (id: string) => {
      onNewest.current = false;
      anchor.current = id;
      setFocusId(id);
      setSelectedIds((picked) =>
        picked.includes(id) ? picked.filter((each) => each !== id) : inListOrder([...picked, id]),
      );
    },
    [inListOrder],
  );

  const extendTo = useCallback((id: string) => {
    onNewest.current = false;
    setFocusId(id);
    setSelectedIds(between(shown.current, anchor.current ?? id, id));
  }, []);

  const move = useCallback((step: number) => pickOne(stepFrom(shown.current, focus.current, step)), [pickOne]);

  const extend = useCallback(
    (step: number) => {
      const next = stepFrom(shown.current, focus.current, step);
      if (next === null) return;
      onNewest.current = false;
      setFocusId(next);
      setSelectedIds((picked) => inListOrder([...picked, next]));
    },
    [inListOrder],
  );

  const openOnNewest = useCallback(() => {
    onNewest.current = true;
    // A cleared search asks again by itself.
    if (queryRef.current) setQuery("");
    else void refresh();
  }, [refresh]);

  const act = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [refresh],
  );

  const setEnabled = useCallback((next: boolean) => act(() => api.setEnabled(next)), [act, api]);
  const pin = useCallback(
    (ids: string[], pinned: boolean) => act(() => Promise.all(ids.map((id) => api.pin(id, pinned)))),
    [act, api],
  );
  const forget = useCallback((id: string) => act(() => api.forget(id)), [act, api]);
  const clear = useCallback(() => act(() => api.clear()), [act, api]);
  const openPrivacySettings = useCallback(() => act(() => api.openPrivacySettings()), [act, api]);

  return {
    enabled,
    access,
    items,
    query,
    selectedIds,
    focusId,
    error,
    setQuery: search,
    select: pickOne,
    toggle,
    extendTo,
    move,
    extend,
    openOnNewest,
    refresh,
    setEnabled,
    pin,
    forget,
    clear,
    openPrivacySettings,
  };
}

/** The entry copied last, wherever pinning puts it in the list. */
function newestId(items: ClipboardSummary[]): string | null {
  const newest = items.reduce<ClipboardSummary | null>((latest, item) => (!latest || item.copiedAt > latest.copiedAt ? item : latest), null);
  return newest?.id ?? null;
}

/** The entry `step` away from `from` in the list, staying within it. */
function stepFrom(items: ClipboardSummary[], from: string | null, step: number): string | null {
  if (items.length === 0) return null;
  const index = items.findIndex((item) => item.id === from);
  const next = Math.min(items.length - 1, Math.max(0, (index < 0 ? 0 : index) + step));
  return items[next]?.id ?? null;
}

/** Every entry from one to the other, whichever comes first in the list. */
function between(items: ClipboardSummary[], one: string, other: string): string[] {
  const ends = [one, other].map((id) => items.findIndex((item) => item.id === id)).filter((index) => index >= 0);
  if (ends.length === 0) return [];
  const [first, last] = [Math.min(...ends), Math.max(...ends)];
  return items.slice(first, last + 1).map((item) => item.id);
}
