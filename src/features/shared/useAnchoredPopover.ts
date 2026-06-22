import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

/**
 * Fixed coordinates for a portaled popover, clamped into the viewport. Exactly
 * one of `top` / `bottom` is set, per the chosen placement; the rest spreads
 * into the popover's `style`.
 */
export interface AnchoredCoords {
  /** Placement "below": offset from the viewport top. */
  top?: number;
  /** Placement "above": offset from the viewport bottom. */
  bottom?: number;
  left: number;
  width: number;
}

export interface UseAnchoredPopoverOptions<Popover extends HTMLElement> {
  /** "below" anchors under the trigger; "above" anchors over it. */
  placement: "above" | "below";
  /** Cap on the popover width before the viewport clamp. */
  maxWidth?: number;
  /** Gap in px between the trigger edge and the popover. */
  gap?: number;
  /**
   * The element to focus when the popover opens — typically the active item,
   * falling back to the first. Called once per open with the portaled popover.
   */
  getInitialFocus?: (popover: Popover) => HTMLElement | null | undefined;
}

export interface UseAnchoredPopoverResult<Trigger extends HTMLElement, Popover extends HTMLElement> {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  /** Null until placed; render the popover only once it is set. */
  coords: AnchoredCoords | null;
  triggerRef: RefObject<Trigger>;
  popoverRef: RefObject<Popover>;
}

function anchor(
  trigger: HTMLElement,
  placement: "above" | "below",
  maxWidth: number,
  gap: number,
): AnchoredCoords {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(maxWidth, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  return placement === "below"
    ? { top: rect.bottom + gap, left, width }
    : { bottom: window.innerHeight - rect.top + gap, left, width };
}

/**
 * Drives a portaled popover anchored to a trigger: open state, fixed
 * viewport-clamped coordinates ({@link AnchoredCoords}), outside-press/Escape
 * dismissal that treats both the trigger and the (portaled) popover as inside,
 * and one-shot focus into the popover on open. Holding both refs is what lets
 * the dismissal reach across the portal boundary — the reason
 * {@link useDismissableLayer}, built for a single in-tree root, can't cover it.
 */
export function useAnchoredPopover<
  Trigger extends HTMLElement = HTMLElement,
  Popover extends HTMLElement = HTMLElement,
>({
  placement,
  maxWidth = 320,
  gap = 4,
  getInitialFocus,
}: UseAnchoredPopoverOptions<Popover>): UseAnchoredPopoverResult<Trigger, Popover> {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<AnchoredCoords | null>(null);
  const triggerRef = useRef<Trigger>(null);
  const popoverRef = useRef<Popover>(null);
  const focused = useRef(false);

  const getInitialFocusRef = useRef(getInitialFocus);
  getInitialFocusRef.current = getInitialFocus;

  // Anchor the popover on open and keep it anchored on resize; cleared on close
  // so the next open recomputes. The popover renders only once `coords` is set,
  // so it never paints before it's placed.
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!open || !trigger) {
      setCoords(null);
      return;
    }
    const reposition = () => setCoords(anchor(trigger, placement, maxWidth, gap));
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [open, placement, maxWidth, gap]);

  // Dismiss on an outside press (the trigger and the portaled popover both count
  // as inside) or Escape — Escape restores focus to the trigger.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Land focus inside the popover once it is mounted — once per open, so a
  // resize-driven reposition doesn't yank focus back to the top.
  useEffect(() => {
    if (!open) {
      focused.current = false;
      return;
    }
    if (focused.current || !coords) return;
    focused.current = true;
    const pop = popoverRef.current;
    if (pop) getInitialFocusRef.current?.(pop)?.focus();
  }, [open, coords]);

  return { open, setOpen, coords, triggerRef, popoverRef };
}
