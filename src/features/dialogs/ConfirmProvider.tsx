import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "@carbon/react";

/**
 * Options for a single confirmation — the in-app, Tauri-safe replacement for
 * `window.confirm`.
 *
 * In the packaged `.app` (WKWebView via wry) `window.confirm` is not wired to a
 * usable dialog: it returns a *rejecting Promise* rather than a synchronous
 * boolean, so `if (!window.confirm(...))` reads a (truthy) Promise object,
 * skips the guard, and the destructive action runs anyway — the rejection
 * surfaces only as an unhandled-promise log. This provider renders one real
 * Carbon modal and hands back an imperative `confirm` resolving to a true
 * boolean, mirroring {@link useTextPrompt}.
 */
export interface ConfirmOptions {
  /** Modal heading, e.g. "Delete file". */
  title: string;
  /** The question being confirmed, shown in the body. */
  message: string;
  /** Primary (confirm) button text; defaults to "OK". */
  confirmLabel?: string;
  /** Secondary (cancel) button text; defaults to "Cancel". */
  cancelLabel?: string;
  /** Style the primary action as destructive (Carbon `danger`). Default false. */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Returns `confirm(options) => Promise<boolean>` (`true` = confirmed, `false` =
 * cancelled or dismissed). Must be used under a {@link ConfirmProvider}.
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used within a ConfirmProvider");
  }
  return confirm;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Renders a single shared modal at the app root and exposes the imperative
 * `confirm`. One instance backs every `window.confirm` call site; only one
 * confirmation shows at a time (a second `confirm` while one is open replaces
 * the pending state — in practice these are user-driven and serial).
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    setPending((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={pending !== null}
        modalHeading={pending?.title ?? ""}
        primaryButtonText={pending?.confirmLabel ?? "OK"}
        secondaryButtonText={pending?.cancelLabel ?? "Cancel"}
        danger={pending?.danger ?? false}
        size="sm"
        onRequestSubmit={() => settle(true)}
        onRequestClose={() => settle(false)}
      >
        <p className="confirm-modal__message">{pending?.message ?? ""}</p>
      </Modal>
    </ConfirmContext.Provider>
  );
}
