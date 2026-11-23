import { OverflowMenu, OverflowMenuItem } from "@carbon/react";
import { ChevronDown } from "lucide-react";
import { useCallback, useRef } from "react";

import { canShowNativeMenu, showNativeMenu, type NativeMenuEntry } from "../../lib/runtime/nativeMenu";

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
  const formats = markdownExport ? FORMATS : FORMATS.filter((format) => format.id !== "markdown");
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const openNative = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const entries: NativeMenuEntry[] = formats.flatMap(({ id, label }) => [
      ...(id === "image" ? (["separator"] as const) : []),
      { id, label },
    ]);
    void showNativeMenu(entries, (id) => onExport(id as DocumentExportFormat), { x: rect.left, y: rect.bottom + 4 });
  }, [formats, onExport]);

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
      {formats.map(({ id, label }) => (
        <ExportItem key={id} format={id} label={label} onExport={onExport} />
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

function ExportItem({ format, label, onExport }: { format: DocumentExportFormat; label: string; onExport: (format: DocumentExportFormat) => void }) {
  const handleClick = useCallback(() => onExport(format), [onExport, format]);
  return <OverflowMenuItem itemText={label} onClick={handleClick} />;
}
