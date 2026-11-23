import { Tag } from "lucide-react";
import { useCallback } from "react";
import { createPortal } from "react-dom";

import { ActiveFileProperties, useActiveFileFieldCount, useCanEditActiveFileProperties } from "../workspace/ActiveFilePanels";
import { useAnchoredPopover } from "../shared/useAnchoredPopover";

/**
 * "Properties" at the left of the editor's bottom bar, with how many fields
 * the note has. Opens the note's properties in a popover above it, out of the
 * way of the writing until asked for; it closes on a click back in the note.
 */
export function PropertiesButton() {
  const canEdit = useCanEditActiveFileProperties();
  const count = useActiveFileFieldCount();
  const { open, setOpen, coords, triggerRef, popoverRef } = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    placement: "above",
    align: "start",
    maxWidth: 340,
    gap: 6,
    getInitialFocus: (pop) => pop.querySelector<HTMLElement>("input, button"),
  });
  const toggle = useCallback(() => setOpen((value) => !value), [setOpen]);

  if (!canEdit) return null;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="properties-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <Tag size={13} strokeWidth={1.75} aria-hidden />
        <span>Properties</span>
        {count > 0 ? <span className="properties-button__count">{count}</span> : null}
      </button>
      {open && coords
        ? createPortal(
            <div
              ref={popoverRef}
              className="properties-popover"
              role="dialog"
              aria-label="Properties"
              style={{ bottom: coords.bottom, left: coords.left, inlineSize: coords.width }}
            >
              <ActiveFileProperties />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
