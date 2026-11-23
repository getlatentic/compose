import { useCallback, useMemo, useRef, useState } from "react";
import {
  OverflowMenuVertical,
  Edit,
  Copy,
  DocumentExport,
  Archive,
  TrashCan,
} from "@carbon/react/icons";

import { useDismissableLayer } from "./useDismissableLayer";
import { canShowNativeMenu, showNativeMenu, type MenuAction } from "../../lib/runtime/nativeMenu";

/** The actions the ⋮ menu can fire against a single conversation. */
export interface ConversationActions {
  onRename: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

interface ConversationMenuAction extends MenuAction {
  readonly icon: typeof Edit;
}

/**
 * The per-conversation overflow (⋮) menu: Rename, Duplicate, Export to
 * Markdown, Archive / Unarchive, Delete. In Compose the system draws it under
 * the button, with Delete set apart below a separator; elsewhere a light
 * inline popover opens downward from the chat header. Archive's label flips
 * with the conversation's current state.
 */
export function ConversationActionsMenu({
  archived,
  actions,
  align = "end",
}: {
  /** Whether the target conversation is currently archived (flips the label). */
  archived: boolean;
  actions: ConversationActions;
  /** Which edge the popover aligns to. */
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissableLayer(open, close, rootRef);

  const items = useMemo<ConversationMenuAction[]>(
    () => [
      { label: "Rename", icon: Edit, run: actions.onRename },
      { label: "Duplicate", icon: Copy, run: actions.onDuplicate },
      { label: "Export to Markdown", icon: DocumentExport, run: actions.onExport },
      { label: archived ? "Unarchive" : "Archive", icon: Archive, run: actions.onArchive },
      { label: "Delete", icon: TrashCan, run: actions.onDelete, danger: true, startsGroup: true },
    ],
    [archived, actions],
  );

  const toggle = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!canShowNativeMenu() || !rect) {
      setOpen((value) => !value);
      return;
    }
    void showNativeMenu(items, { x: rect.left, y: rect.bottom + 4 });
  }, [items]);

  return (
    <div className="conv-menu" ref={rootRef}>
      <button
        type="button"
        className="icon-button conv-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Conversation actions"
        title="Conversation actions"
        onClick={toggle}
      >
        <OverflowMenuVertical size={16} />
      </button>
      {open ? (
        <ul className={`conv-menu__list conv-menu__list--${align}`} role="menu" aria-label="Conversation actions">
          {items.map((item) => (
            <ConversationMenuRow key={item.label} item={item} onChosen={close} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ConversationMenuRow({ item, onChosen }: { item: ConversationMenuAction; onChosen: () => void }) {
  const { icon: Icon, label, danger, run } = item;
  const choose = useCallback(() => {
    onChosen();
    run();
  }, [onChosen, run]);
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        className={danger ? "conv-menu__item conv-menu__item--danger" : "conv-menu__item"}
        onClick={choose}
      >
        <Icon size={16} aria-hidden />
        <span>{label}</span>
      </button>
    </li>
  );
}
