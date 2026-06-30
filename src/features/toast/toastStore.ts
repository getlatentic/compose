import { create } from "zustand";

export type ToastKind = "error" | "success" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message: string;
  /** Auto-dismiss after this many ms. 0 = sticky. */
  timeoutMs: number;
  /** How many times this identical toast has been raised. Shown as "(×N)" so a
   *  re-firing error (a watcher event, a retried save) reads as one toast, not
   *  a stack of duplicates. */
  count: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Toast) => void;
  dismiss: (id: string) => void;
}

/**
 * Global, portal-rendered toasts. A **standalone store** so anything —
 * store actions, utilities, deep components — can raise a toast via the
 * imperative helpers below without a `set`/subscription or a React context.
 * `<ToastViewport/>` (mounted once at the app root) renders the list through
 * `createPortal(document.body)`, so toasts float above every pane/modal.
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) =>
    set((state) => {
      // Coalesce an identical toast (same kind + title + message) already on
      // screen: bump its count and swap in the new id so the viewport re-arms
      // its dismiss timer — one refreshing toast instead of a duplicate stack.
      const index = state.toasts.findIndex(
        (t) => t.kind === toast.kind && t.title === toast.title && t.message === toast.message,
      );
      if (index >= 0) {
        const toasts = state.toasts.slice();
        toasts[index] = { ...toast, count: state.toasts[index].count + 1 };
        return { toasts };
      }
      return { toasts: [...state.toasts, toast] };
    }),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

let seq = 0;

/** Raise a toast from anywhere — `useToastStore.getState().push` under the hood. */
export function showToast(opts: {
  kind: ToastKind;
  title?: string;
  message: string;
  timeoutMs?: number;
}): string {
  const id = `toast-${Date.now()}-${(seq += 1)}`;
  useToastStore.getState().push({
    id,
    kind: opts.kind,
    title: opts.title ?? defaultTitle(opts.kind),
    message: opts.message,
    timeoutMs: opts.timeoutMs ?? (opts.kind === "error" ? 8000 : 6000),
    count: 1,
  });
  return id;
}

/** Shorthand for the common case: a failure surfaced to the user. */
export function showErrorToast(message: string, title = "Something went wrong"): string {
  return showToast({ kind: "error", title, message });
}

function defaultTitle(kind: ToastKind): string {
  return kind === "error" ? "Something went wrong" : kind === "success" ? "Done" : "Notice";
}
