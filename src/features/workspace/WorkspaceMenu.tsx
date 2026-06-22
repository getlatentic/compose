import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Add, Checkmark, ChevronDown, Close, Folder } from "@carbon/react/icons";

import { tildePath } from "../../lib/workspace/displayPath";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { useWorkspaceActions } from "./useWorkspaceActions";

/**
 * The sidebar workspace switcher, pinned to the top of {@link WorkspaceSidebar}.
 * The trigger shows the active folder; the dropdown lists recent workspaces one
 * row each (folder + name + home-relative path), marks the active one with a
 * checkmark + accent bar, reveals a remove (✕) affordance on hover, and offers
 * "Open a folder…". All open logic lives in {@link useWorkspaceActions}, shared
 * with the no-workspace welcome card.
 *
 * A hand-rolled popover (not Carbon's `OverflowMenu`) so each row can compose an
 * icon, name, path, and a per-row secondary action — structure `OverflowMenu`
 * couldn't express without a second "Remove from list" row per workspace. It is
 * portaled and fixed-positioned because the sidebar clips overflow and is short
 * (`overflow: hidden`, `max-block-size`), which would otherwise crop the menu.
 */
export interface WorkspaceMenuItem {
  id: string;
  name: string;
  /** Absolute path; rendered home-relative via {@link tildePath}. */
  path: string;
  isActive: boolean;
}

export interface WorkspaceMenuViewProps {
  activeName: string;
  activePath?: string;
  items: WorkspaceMenuItem[];
  /** Browser preview only: offer the bundled sample workspace. */
  showSample: boolean;
  onOpenWorkspace: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenFolder: () => void;
  onOpenSample: () => void;
}

const ROW = ".ws-item__open";

interface PopoverCoords {
  top: number;
  left: number;
  width: number;
}

/** Anchor the dropdown just under the trigger, clamped into the viewport. */
function anchorBelow(trigger: HTMLElement): PopoverCoords {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  return { top: rect.bottom + 4, left, width };
}

export function WorkspaceMenuView({
  activeName,
  activePath,
  items,
  showSample,
  onOpenWorkspace,
  onRemove,
  onOpenFolder,
  onOpenSample,
}: WorkspaceMenuViewProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  // Position the dropdown under the trigger before paint and keep it anchored on
  // resize; cleared on close so the next open recomputes from scratch.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    if (!open || !trigger) {
      setCoords(null);
      return;
    }
    const reposition = () => setCoords(anchorBelow(trigger));
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [open]);

  // Dismiss on outside click (the trigger and the portaled popover both count as
  // "inside") or Escape — Escape restores focus to the trigger.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Land focus on the active row (else the first) once the dropdown is mounted —
  // once per open, so a resize-driven reposition doesn't yank focus back.
  useEffect(() => {
    if (!open) {
      focused.current = false;
      return;
    }
    if (focused.current || !coords) return;
    focused.current = true;
    const pop = popoverRef.current;
    (
      pop?.querySelector<HTMLButtonElement>(`${ROW}[data-active="true"]`) ??
      pop?.querySelector<HTMLButtonElement>(ROW)
    )?.focus();
  }, [open, coords]);

  // Roving Up/Down between rows (Tab still reaches the per-row ✕ and footer).
  function onArrowKeys(event: React.KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(popoverRef.current?.querySelectorAll<HTMLButtonElement>(ROW) ?? []);
    if (rows.length === 0) return;
    event.preventDefault();
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    rows[(current + delta + rows.length) % rows.length]?.focus();
  }

  return (
    <div className="workspace-switcher" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="workspace-switcher__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={activePath}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="workspace-switcher__trigger-icon">
          <Folder size={16} aria-hidden />
        </span>
        <span className="workspace-switcher__name truncate">{activeName}</span>
        <ChevronDown size={16} className="workspace-switcher__chevron" aria-hidden />
      </button>

      {open && coords
        ? createPortal(
            <div
              ref={popoverRef}
              className="workspace-switcher__popover"
              role="menu"
              aria-label="Switch workspace"
              style={{ top: coords.top, left: coords.left, inlineSize: coords.width }}
              onKeyDown={onArrowKeys}
            >
              {items.length > 0 ? (
                <ul className="workspace-switcher__list">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className={`ws-item${item.isActive ? " ws-item--active" : ""}`}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="ws-item__open"
                        data-active={item.isActive ? "true" : undefined}
                        title={item.path}
                        onClick={() => {
                          onOpenWorkspace(item.id);
                          setOpen(false);
                        }}
                      >
                        <Folder size={16} className="ws-item__icon" aria-hidden />
                        <span className="ws-item__name truncate">{item.name}</span>
                        <span className="ws-item__path truncate">{tildePath(item.path)}</span>
                        {item.isActive ? (
                          <Checkmark
                            size={16}
                            className="ws-item__check"
                            aria-label="Current workspace"
                          />
                        ) : null}
                      </button>
                      {item.isActive ? null : (
                        <button
                          type="button"
                          className="ws-item__remove"
                          aria-label={`Remove ${item.name} from list`}
                          title="Remove from list. Your files are not deleted."
                          onClick={() => onRemove(item.id)}
                        >
                          <Close size={16} aria-hidden />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="workspace-switcher__footer">
                <button
                  type="button"
                  role="menuitem"
                  className="ws-item__open ws-item__action"
                  onClick={() => {
                    setOpen(false);
                    onOpenFolder();
                  }}
                >
                  <Add size={16} className="ws-item__icon" aria-hidden />
                  <span className="ws-item__name">Open a folder…</span>
                </button>
                {showSample ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="ws-item__open ws-item__action"
                    onClick={() => {
                      setOpen(false);
                      onOpenSample();
                    }}
                  >
                    <Folder size={16} className="ws-item__icon" aria-hidden />
                    <span className="ws-item__name">Use sample workspace</span>
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function WorkspaceMenuInner() {
  const { recent, openFolder, openSample, openWorkspace, removeRecent, canOpenNativeFolder } =
    useWorkspaceActions();
  // Narrow selector: just the active id (a workspace switch, not a note edit,
  // re-renders the switcher). Name/path come from `recent`, already subscribed.
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const active = recent.find((record) => record.id === activeWorkspaceId);
  const items = recent.slice(0, 8).map((record) => ({
    id: record.id,
    name: record.name,
    path: record.path,
    isActive: record.id === activeWorkspaceId,
  }));

  return (
    <WorkspaceMenuView
      activeName={active?.name ?? "No folder open"}
      activePath={active?.path}
      items={items}
      showSample={!canOpenNativeFolder}
      onOpenWorkspace={openWorkspace}
      onRemove={(id) => void removeRecent(id)}
      onOpenFolder={() => void openFolder()}
      onOpenSample={() => void openSample()}
    />
  );
}

/**
 * Memoised — reads its name/path/recent via narrow selectors, so it
 * re-renders only when the workspace switcher's own data changes, not
 * on every note edit that re-renders the surrounding sidebar.
 */
export const WorkspaceMenu = memo(WorkspaceMenuInner);
