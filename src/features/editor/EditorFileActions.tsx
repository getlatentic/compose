import { OverflowMenu, OverflowMenuItem } from "@carbon/react";
import { DocumentExport, Save, Time } from "@carbon/react/icons";
import type { ReactNode } from "react";

/**
 * The current-file actions, right-aligned in the editor toolbar so they share
 * one bar (one background) with the formatting buttons. Pulled out of the
 * global app header so that header holds only app chrome (Home / Settings /
 * panels) and these file-scoped actions sit next to the document they act on.
 *
 * Fed stable callbacks (the editor is memoized — see TiptapMarkdownEditor), so
 * this never re-renders on a keystroke.
 */
export type DocumentExportFormat = "markdown" | "html" | "pdf";

export interface EditorFileActionsProps {
  onSave: () => void;
  onShowVersionHistory: () => void;
  onExport: (format: DocumentExportFormat) => void;
}

export function EditorFileActions({
  onSave,
  onShowVersionHistory,
  onExport,
}: EditorFileActionsProps) {
  return (
    <div className="bob-tiptap-toolbar__file-actions" role="group" aria-label="File">
      <FileButton label="Save" shortcut="⌘S" onClick={onSave} icon={<Save size={16} />} />
      <FileButton
        label="Previous versions"
        onClick={onShowVersionHistory}
        icon={<Time size={16} />}
      />
      <OverflowMenu
        aria-label="Export"
        size="sm"
        flipped
        align="bottom"
        className="bob-tiptap-toolbar__export"
        renderIcon={() => <DocumentExport size={16} />}
      >
        <OverflowMenuItem itemText="Markdown (.md)" onClick={() => onExport("markdown")} />
        <OverflowMenuItem itemText="HTML (.html)" onClick={() => onExport("html")} />
        <OverflowMenuItem itemText="PDF (.pdf)" onClick={() => onExport("pdf")} />
      </OverflowMenu>
    </div>
  );
}

function FileButton({
  label,
  shortcut,
  onClick,
  icon,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  icon: ReactNode;
}) {
  const fullLabel = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      className="bob-tiptap-toolbar__button"
      aria-label={fullLabel}
      title={fullLabel}
      // Don't steal focus from the editor when clicked.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
