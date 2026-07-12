import { useCallback } from "react";
import { useUiStore, type ResizablePane } from "../../app/store/uiStore";

/**
 * The drag handle on a pane edge (#119) — sidebar's right, chat's left.
 *
 * Per-pixel updates write the grid's CSS variable DIRECTLY on the
 * `.workspace` element: no store write, no React render, so dragging never
 * touches the keystroke-tuned render paths. The store (and persistence)
 * hears about it once, on release. Double-click resets the pane to its
 * default width.
 */

/** Width clamps (px). The editor keeps its own floor via the grid's
 *  `minmax`; the dynamic clamp below also stops a drag from pushing the
 *  editor under ~17rem on small windows. */
const LIMITS: Record<ResizablePane, { min: number; max: number; cssVar: string }> = {
  sidebar: { min: 180, max: 480, cssVar: "--sidebar-w" },
  chat: { min: 320, max: 640, cssVar: "--chat-w" },
};
const MIN_EDITOR_PX = 272;

function otherPaneWidth(workspace: HTMLElement, pane: ResizablePane): number {
  const other = LIMITS[pane === "sidebar" ? "chat" : "sidebar"];
  const raw = getComputedStyle(workspace).getPropertyValue(other.cssVar);
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function PaneSplitter({ pane }: { pane: ResizablePane }) {
  const setPaneWidth = useUiStore((state) => state.setPaneWidth);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const splitter = event.currentTarget;
      const workspace = splitter.closest<HTMLElement>(".workspace");
      if (!workspace) return;
      event.preventDefault();
      splitter.setPointerCapture(event.pointerId);
      document.body.classList.add("pane-resizing");

      const { min, max, cssVar } = LIMITS[pane];
      let committed: number | null = null;

      const onMove = (moveEvent: PointerEvent) => {
        const rect = workspace.getBoundingClientRect();
        const raw =
          pane === "sidebar" ? moveEvent.clientX - rect.left : rect.right - moveEvent.clientX;
        // Static clamps first, then the live one: never squeeze the editor
        // out of its minimum on a small window.
        const roomMax = rect.width - otherPaneWidth(workspace, pane) - MIN_EDITOR_PX;
        const width = Math.round(Math.min(Math.max(raw, min), Math.min(max, roomMax)));
        committed = width;
        workspace.style.setProperty(cssVar, `${width}px`);
      };
      const finish = () => {
        splitter.removeEventListener("pointermove", onMove);
        document.body.classList.remove("pane-resizing");
        if (committed !== null) {
          setPaneWidth(pane, committed);
        }
      };
      splitter.addEventListener("pointermove", onMove);
      splitter.addEventListener("pointerup", finish, { once: true });
      splitter.addEventListener("pointercancel", finish, { once: true });
    },
    [pane, setPaneWidth],
  );

  const onDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // React never owned the drag-written inline var, so clear it by hand —
      // the store reset alone wouldn't strip it from the element.
      event.currentTarget
        .closest<HTMLElement>(".workspace")
        ?.style.removeProperty(LIMITS[pane].cssVar);
      setPaneWidth(pane, null);
    },
    [pane, setPaneWidth],
  );

  return (
    <div
      className={`pane-splitter pane-splitter--${pane}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={pane === "sidebar" ? "Resize sidebar" : "Resize chat panel"}
      title="Drag to resize · double-click to reset"
      data-tauri-drag-region="false"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
