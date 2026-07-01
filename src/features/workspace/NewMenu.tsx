import { useCallback, useEffect, useRef, useState } from "react";
import { Chat, ChevronDown, Document, Folder } from "@carbon/react/icons";

type CarbonIcon = typeof Document;

interface NewMenuItem {
  key: string;
  label: string;
  shortcut?: string;
  Icon: CarbonIcon;
  run: () => void;
}

interface NewMenuProps {
  /** Which tab is active — decides which create action the menu leads with. */
  tab: "files" | "chat";
  disabled: boolean;
  onNewNote: () => void;
  onNewFolder: () => void;
  onNewChat: () => void;
}

/**
 * The single "+ New" create menu at the end of the sidebar tab row. A custom
 * dropdown (not Carbon's `MenuButton`) so it hits the interaction spec exactly:
 * a 246px panel of 46px rows — 16px icon, label, right-aligned mono shortcut —
 * with neutral (not blue-tinted) hover, and a trigger whose caret sits right
 * after the label with no boxed divider. The menu leads with the current tab's
 * subject: New note on Notes, New chat on Chat.
 */
export function NewMenu({ tab, disabled, onNewNote, onNewFolder, onNewChat }: NewMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape while open — the two ways out of a menu
  // that isn't a modal. Listeners only live while the panel is open.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  const pick = useCallback((run: () => void) => {
    setOpen(false);
    run();
  }, []);

  const note: NewMenuItem = { key: "note", label: "New note", shortcut: "⌘N", Icon: Document, run: onNewNote };
  const folder: NewMenuItem = { key: "folder", label: "New folder", shortcut: "⌘⇧N", Icon: Folder, run: onNewFolder };
  const chat: NewMenuItem = { key: "chat", label: "New chat", Icon: Chat, run: onNewChat };
  // A divider splits the file-system actions from chat; the leading group tracks
  // the active tab so the button always opens with what that tab is about.
  const groups: NewMenuItem[][] = tab === "files" ? [[note, folder], [chat]] : [[chat], [note, folder]];

  return (
    <div className="new-menu" ref={rootRef}>
      <button
        type="button"
        className="new-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
      >
        <span className="new-menu__plus" aria-hidden>
          +
        </span>
        <span className="new-menu__label">New</span>
        <ChevronDown size={16} className="new-menu__caret" aria-hidden />
      </button>
      {open ? (
        <div className="new-menu__panel" role="menu">
          {groups.map((group) => (
            <div className="new-menu__group" key={group[0].key} role="none">
              {group.map(({ key, label, shortcut, Icon, run }) => (
                <button
                  type="button"
                  role="menuitem"
                  className="new-menu__item"
                  key={key}
                  onClick={() => pick(run)}
                >
                  <Icon size={16} className="new-menu__item-icon" aria-hidden />
                  <span className="new-menu__item-label">{label}</span>
                  {shortcut ? <span className="new-menu__item-shortcut">{shortcut}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
