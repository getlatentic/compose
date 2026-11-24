import { useSyncExternalStore } from "react";

/**
 * One value that one part of the tree sets and another, unrelated part reads:
 * an element to portal into, the editor that is live now. React re-renders
 * readers when it changes.
 */
export interface ValueStore<T> {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
  use: () => T;
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const get = () => value;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const set = (next: T) => {
    if (Object.is(next, value)) return;
    value = next;
    for (const listener of listeners) listener();
  };
  return { get, set, subscribe, use: () => useSyncExternalStore(subscribe, get, get) };
}
