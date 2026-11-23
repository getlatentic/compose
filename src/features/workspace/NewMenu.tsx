import { FilePlus, FolderPlus, MessageSquarePlus, Plus, type LucideIcon } from "lucide-react";
import { useCallback, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { useAnchoredPopover } from "../shared/useAnchoredPopover";

interface NewMenuItem {
  key: string;
  label: string;
  shortcut?: string;
  Icon: LucideIcon;
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

const MENU_WIDTH = 232;

/**
 * The sidebar footer's +: a menu of what can be made, opening upward and
 * ending at the button's right edge so it stays over the sidebar. Each row
 * is an icon, a label and its shortcut, in Compose's own surface (a native
 * menu cannot draw icons this way). It leads with the current tab's subject:
 * New note on Notes, New chat on Chat. Arrow keys move between rows.
 */
export function NewMenu({ tab, disabled, onNewNote, onNewFolder, onNewChat }: NewMenuProps) {
  const { open, setOpen, coords, triggerRef, popoverRef } = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    placement: "above",
    align: "end",
    maxWidth: MENU_WIDTH,
    gap: 8,
    getInitialFocus: (pop) => pop.querySelector<HTMLButtonElement>(".new-menu__item"),
  });

  const note: NewMenuItem = { key: "note", label: "New note", shortcut: "⌘N", Icon: FilePlus, run: onNewNote };
  const folder: NewMenuItem = { key: "folder", label: "New folder", shortcut: "⇧⌘N", Icon: FolderPlus, run: onNewFolder };
  const chat: NewMenuItem = { key: "chat", label: "New chat", Icon: MessageSquarePlus, run: onNewChat };
  const groups: NewMenuItem[][] = tab === "files" ? [[note, folder], [chat]] : [[chat], [note, folder]];

  const toggle = useCallback(() => setOpen((value) => !value), [setOpen]);
  const pick = useCallback(
    (run: () => void) => {
      setOpen(false);
      run();
    },
    [setOpen],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="sidebar-footer__btn new-menu__trigger"
        aria-label="New"
        title="New note, folder or chat"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
      >
        <Plus size={16} strokeWidth={1.75} aria-hidden />
      </button>
      {open && coords
        ? createPortal(
            <div
              ref={popoverRef}
              className="new-menu__panel"
              role="menu"
              aria-label="New"
              onKeyDown={moveFocus}
              style={{ bottom: coords.bottom, left: coords.left, inlineSize: coords.width }}
            >
              {groups.map((group) => (
                <div className="new-menu__group" key={group[0].key} role="none">
                  {group.map((item) => (
                    <NewMenuRow key={item.key} item={item} onPick={pick} />
                  ))}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function NewMenuRow({ item, onPick }: { item: NewMenuItem; onPick: (run: () => void) => void }) {
  const { label, shortcut, Icon, run } = item;
  const click = useCallback(() => onPick(run), [onPick, run]);
  return (
    <button type="button" role="menuitem" className="new-menu__item" onClick={click}>
      <Icon size={18} strokeWidth={1.75} className="new-menu__item-icon" aria-hidden />
      <span className="new-menu__item-label">{label}</span>
      {shortcut ? <span className="new-menu__item-shortcut">{shortcut}</span> : null}
    </button>
  );
}

/** Up and Down move between the rows, wrapping at the ends. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".new-menu__item")];
  const index = rows.indexOf(document.activeElement as HTMLButtonElement);
  const step = event.key === "ArrowDown" ? 1 : -1;
  rows[(index + step + rows.length) % rows.length]?.focus();
}
