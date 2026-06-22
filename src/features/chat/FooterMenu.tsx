import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "@carbon/react/icons";

export interface FooterMenuItem {
  value: string;
  label: string;
}

/**
 * A compact text-and-chevron dropdown for the composer footer — the
 * harness / model selectors. Deliberately *not* a Carbon form `Dropdown`
 * (its field chrome and min-width shift the footer); this is a plain inline
 * trigger that opens a small popover **upward** (the footer sits at the
 * panel's bottom edge). Closes on outside-click or Escape.
 */
export function FooterMenu({
  label,
  ariaLabel,
  items,
  selected,
  onSelect,
  disabled = false,
  className = "",
}: {
  /** Text shown in the trigger (current selection's label). */
  label: string;
  /** Accessible name for the trigger (e.g. "Assistant", "Model"). */
  ariaLabel: string;
  items: FooterMenuItem[];
  selected: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
  /** Extra class on the root — e.g. `footer-menu--grow` to let a long label
   *  share and truncate the footer's free space instead of overflowing it. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={["footer-menu", className].filter(Boolean).join(" ")} ref={rootRef}>
      <button
        type="button"
        className="footer-menu__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        // Surfaces the full label when a long one is truncated to fit the row.
        title={label}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="footer-menu__label">{label}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {open ? (
        <ul className="footer-menu__list" role="listbox" aria-label={ariaLabel}>
          {items.map((item) => (
            <li key={item.value} role="option" aria-selected={item.value === selected}>
              <button
                type="button"
                className={[
                  "footer-menu__item",
                  item.value === selected ? "footer-menu__item--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  onSelect(item.value);
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
