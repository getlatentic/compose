import { OverflowMenu, OverflowMenuItem } from "@carbon/react";
import { ChevronDown } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";

import { canShowNativeMenu, showNativeMenu, type MenuAction } from "../../lib/runtime/nativeMenu";

export type DocumentExportFormat = "markdown" | "html" | "pdf" | "image";

const FORMATS: readonly { id: DocumentExportFormat; label: string }[] = [
  { id: "markdown", label: "Markdown (.md)" },
  { id: "html", label: "HTML (.html)" },
  { id: "pdf", label: "PDF (.pdf)" },
  { id: "image", label: "Image for posting…" },
];

interface ExportMenuProps {
  readonly onExport: (format: DocumentExportFormat) => void;
  /** False for a plain-text file, which has no Markdown to export. */
  readonly markdownExport: boolean;
}

/**
 * "Export ▾". In Compose the system draws the menu under the button, as a
 * native macOS menu; elsewhere (the browser dev build) Carbon's menu opens.
 */
export function ExportMenu({ onExport, markdownExport }: ExportMenuProps) {
  const actions = useMemo<MenuAction[]>(
    () =>
      FORMATS.filter((format) => markdownExport || format.id !== "markdown").map(({ id, label }) => ({
        label,
        run: () => onExport(id),
        startsGroup: id === "image",
      })),
    [markdownExport, onExport],
  );
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const openNative = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    void showNativeMenu(actions, { x: rect.left, y: rect.bottom + 4 });
  }, [actions]);

  if (canShowNativeMenu()) {
    return (
      <button
        ref={buttonRef}
        type="button"
        className="tiptap-toolbar__export-button"
        aria-haspopup="menu"
        title="Export"
        onClick={openNative}
      >
        Export
        <ChevronDown size={14} aria-hidden />
      </button>
    );
  }

  return (
    <OverflowMenu
      aria-label="Export"
      size="sm"
      flipped
      align="bottom"
      className="tiptap-toolbar__export"
      iconDescription="Export"
      renderIcon={ExportLabel}
    >
      {actions.map((action) => (
        <OverflowMenuItem key={action.label} itemText={action.label} hasDivider={action.startsGroup} onClick={action.run} />
      ))}
    </OverflowMenu>
  );
}

function ExportLabel() {
  return (
    <span className="tiptap-toolbar__export-label">
      Export
      <ChevronDown size={14} aria-hidden />
    </span>
  );
}
