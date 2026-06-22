import { useEffect, type RefObject } from "react";

/**
 * Close an open popover / overlay on an outside pointer-down or the Escape
 * key. Shared by the conversation history dropdown, the actions menu, and the
 * all-conversations view so each doesn't re-implement the same listeners. No-op
 * while `open` is false, so listeners are only attached when something is showing.
 * (A portaled popover whose content lives outside `rootRef` must also test the
 * popover element — see {@link useAnchoredPopover} — so it uses that instead.)
 */
export function useDismissableLayer(
  open: boolean,
  onClose: () => void,
  rootRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, rootRef]);
}
