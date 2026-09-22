import { useCallback, useEffect, useRef, useState } from "react";

import type { ClipboardApi, ClipboardSummary } from "../captureApi";

/** Typing in the search box asks again after this pause. */
const SEARCH_AFTER_MS = 120;

export interface ClipboardHistoryState {
  /** `null` until the app has said. */
  enabled: boolean | null;
  items: ClipboardSummary[];
  query: string;
  /** The entry the keyboard is on. */
  selectedId: string | null;
  error: string | null;
  setQuery(query: string): void;
  select(id: string): void;
  /** Move the selection by `step` entries, staying within the list. */
  move(step: number): void;
  refresh(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  pin(id: string, pinned: boolean): Promise<void>;
  forget(id: string): Promise<void>;
  clear(): Promise<void>;
}

export function useClipboardHistory(api: ClipboardApi): ClipboardHistoryState {
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const [items, setItems] = useState<ClipboardSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const refresh = useCallback(async () => {
    try {
      const history = await api.history(queryRef.current);
      setEnabledState(history.enabled);
      setItems(history.items);
      setSelectedId((selected) =>
        selected && history.items.some((item) => item.id === selected) ? selected : (history.items[0]?.id ?? null),
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

  const move = useCallback(
    (step: number) => {
      setSelectedId((selected) => {
        if (items.length === 0) return null;
        const index = items.findIndex((item) => item.id === selected);
        const next = Math.min(items.length - 1, Math.max(0, (index < 0 ? 0 : index) + step));
        return items[next]?.id ?? null;
      });
    },
    [items],
  );

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
  const pin = useCallback((id: string, pinned: boolean) => act(() => api.pin(id, pinned)), [act, api]);
  const forget = useCallback((id: string) => act(() => api.forget(id)), [act, api]);
  const clear = useCallback(() => act(() => api.clear()), [act, api]);

  return { enabled, items, query, selectedId, error, setQuery, select: setSelectedId, move, refresh, setEnabled, pin, forget, clear };
}
