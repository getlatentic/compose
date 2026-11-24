import { createPortal } from "react-dom";
import { ActionableNotification, ToastNotification } from "@carbon/react";
import { useCallback, useEffect } from "react";

import { useToastStore, type Toast } from "./toastStore";

/**
 * Renders the global toast list into `document.body` via a portal, so toasts
 * float above every pane and modal regardless of where this is mounted. Mounted
 * once at the app root; raise toasts from anywhere with `showToast` /
 * `showErrorToast` (see toastStore.ts) — no prop-drilling or context.
 */
export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (typeof document === "undefined" || toasts.length === 0) {
    return null;
  }

  return createPortal(
    <div
      className="toast-viewport"
      style={{
        position: "fixed",
        right: "1rem",
        bottom: "1rem",
        zIndex: 9000,
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        maxWidth: "28rem",
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => (toast.action ? <ActionToast key={toast.id} toast={toast} onDismiss={dismiss} /> : <PlainToast key={toast.id} toast={toast} onDismiss={dismiss} />))}
    </div>,
    document.body,
  );
}

interface ToastProps {
  readonly toast: Toast;
  readonly onDismiss: (id: string) => void;
}

function subtitle(toast: Toast): string {
  return toast.count > 1 ? `${toast.message} (×${toast.count})` : toast.message;
}

function PlainToast({ toast, onDismiss }: ToastProps) {
  const close = useCallback(() => {
    onDismiss(toast.id);
    return true;
  }, [onDismiss, toast.id]);
  return (
    <ToastNotification
      kind={toast.kind}
      lowContrast
      title={toast.title}
      subtitle={subtitle(toast)}
      timeout={toast.timeoutMs || undefined}
      onClose={close}
      style={TOAST_STYLE}
    />
  );
}

/** A toast with a button. Carbon's actionable toast has no timer of its own. */
function ActionToast({ toast, onDismiss }: ToastProps) {
  const { id, timeoutMs, action } = toast;
  useEffect(() => {
    if (!timeoutMs) return;
    const timer = window.setTimeout(() => onDismiss(id), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [id, timeoutMs, onDismiss]);
  const close = useCallback(() => {
    onDismiss(id);
    return true;
  }, [onDismiss, id]);
  const act = useCallback(() => {
    action?.run();
    onDismiss(id);
  }, [action, onDismiss, id]);
  return (
    <ActionableNotification
      kind={toast.kind}
      lowContrast
      inline={false}
      title={toast.title}
      subtitle={subtitle(toast)}
      actionButtonLabel={action?.label ?? ""}
      onActionButtonClick={act}
      onClose={close}
      style={TOAST_STYLE}
    />
  );
}

const TOAST_STYLE = { pointerEvents: "auto", maxWidth: "28rem" } as const;
