import { useRef, useState } from "react";
import {
  OverflowMenuVertical,
  Edit,
  Copy,
  DocumentExport,
  Archive,
  TrashCan,
} from "@carbon/react/icons";

import { useDismissableLayer } from "./useDismissableLayer";
import { canShowNativeMenu, showNativeMenu, type NativeMenuEntry } from "../../lib/runtime/nativeMenu";

/** The actions the ⋮ menu can fire against a single conversation. */
export interface ConversationActions {
  onRename: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

interface MenuItem {
  key: string;
  label: string;
  icon: typeof Edit;
  run: (actions: ConversationActions) => void;
  danger?: boolean;
}

/**
 * The per-conversation overflow (⋮) menu: Rename, Duplicate, Export to
 * Markdown, Archive / Unarchive, Delete. A lightweight inline popover — no
 * Carbon `OverflowMenu` chrome — opening downward from the chat header. Delete
 * is styled as a destructive item; archive's label flips with the
 * conversation's current state.
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
  useDismissableLayer(open, () => setOpen(false), rootRef);

  const items: MenuItem[] = [
    { key: "rename", label: "Rename", icon: Edit, run: (a) => a.onRename() },
    { key: "duplicate", label: "Duplicate", icon: Copy, run: (a) => a.onDuplicate() },
    { key: "export", label: "Export to Markdown", icon: DocumentExport, run: (a) => a.onExport() },
    {
      key: "archive",
      label: archived ? "Unarchive" : "Archive",
      icon: Archive,
      run: (a) => a.onArchive(),
    },
    { key: "delete", label: "Delete", icon: TrashCan, run: (a) => a.onDelete(), danger: true },
  ];

  // In Compose the system draws the menu under the button, with Delete set
  // apart below a separator; elsewhere the HTML list below opens.
  const toggle = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!canShowNativeMenu() || !rect) {
      setOpen((value) => !value);
      return;
    }
    const entries: NativeMenuEntry[] = items.flatMap((item) => [
      ...(item.danger ? (["separator"] as const) : []),
      { id: item.key, label: item.label },
    ]);
    const choose = (id: string) => items.find((item) => item.key === id)?.run(actions);
    void showNativeMenu(entries, choose, { x: rect.left, y: rect.bottom + 4 });
  };

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
        <ul
          className={`conv-menu__list conv-menu__list--${align}`}
          role="menu"
          aria-label="Conversation actions"
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.key} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={[
                    "conv-menu__item",
                    item.danger ? "conv-menu__item--danger" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    setOpen(false);
                    item.run(actions);
                  }}
                >
                  <Icon size={16} aria-hidden />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
