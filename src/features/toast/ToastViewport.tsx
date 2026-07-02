import { createPortal } from "react-dom";
import { ToastNotification } from "@carbon/react";
import { useToastStore } from "./toastStore";

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
      {toasts.map((toast) => (
        <ToastNotification
          key={toast.id}
          kind={toast.kind}
          lowContrast
          title={toast.title}
          subtitle={toast.count > 1 ? `${toast.message} (×${toast.count})` : toast.message}
          timeout={toast.timeoutMs || undefined}
          onClose={() => {
            dismiss(toast.id);
            return true;
          }}
          style={{ pointerEvents: "auto", maxWidth: "28rem" }}
        />
      ))}
    </div>,
    document.body,
  );
}
