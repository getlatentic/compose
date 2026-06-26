import { OverflowMenu, OverflowMenuItem } from "@carbon/react";
import {
  ChevronDown,
  History,
  MessageSquareText,
  PanelRight,
  Save,
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * The current-file actions, right-aligned in the editor toolbar so they share
 * one bar (one background) with the formatting buttons. Pulled out of the
 * global app header so that header holds only app chrome (Home / Settings /
 * Chat) and these file-scoped actions sit next to the document they act on.
 *
 * Comments live here too (not in the top bar): comments are per-file, so the
 * toggle belongs next to the document, with the open-comment count surfaced on
 * the button.
 *
 * Icons are lucide (scoped to this file): Save, History (previous versions),
 * MessageSquareText (comments). Export is the one labeled text control — a
 * small "Export" button with a ChevronDown caret — because the user rejected
 * an icon-only export affordance. The rest of the app's chrome stays on Carbon
 * icons.
 *
 * Fed stable callbacks (the editor is memoized — see TiptapMarkdownEditor), so
 * this never re-renders on a keystroke.
 */
export type DocumentExportFormat = "markdown" | "html" | "pdf";

const ICON_SIZE = 16;

export interface EditorFileActionsProps {
  onSave: () => void;
  onShowVersionHistory: () => void;
  onExport: (format: DocumentExportFormat) => void;
  /** Toggle the per-file comments side panel. */
  onToggleComments: () => void;
  /** Whether the comments panel is currently open (drives the pressed state). */
  commentsOpen: boolean;
  /** Open-comment count for the active file, shown as a badge. */
  commentCount: number;
  /** Toggle the chat panel — moved here from the (now-deleted) top header. */
  onToggleChat?: () => void;
  /** Whether the chat panel is currently open (drives the pressed state). */
  chatOpen?: boolean;
  /** Disable the chat toggle when hiding it would leave no pane visible (the
   * store enforces the same guard; the toolbar mirrors it for clarity). */
  chatToggleDisabled?: boolean;
}

export function EditorFileActions({
  onSave,
  onShowVersionHistory,
  onExport,
  onToggleComments,
  commentsOpen,
  commentCount,
  onToggleChat,
  chatOpen = false,
  chatToggleDisabled = false,
}: EditorFileActionsProps) {
  const commentsLabel = commentsOpen
    ? "Hide comments"
    : commentCount > 0
      ? `Show comments (${commentCount})`
      : "Show comments";

  return (
    <div className="tiptap-toolbar__file-actions" role="group" aria-label="File">
      <FileButton
        label="Save"
        shortcut="⌘S"
        onClick={onSave}
        icon={<Save size={ICON_SIZE} />}
      />
      <FileButton
        label="Previous versions"
        onClick={onShowVersionHistory}
        icon={<History size={ICON_SIZE} />}
      />
      <OverflowMenu
        aria-label="Export"
        size="sm"
        flipped
        align="bottom"
        className="tiptap-toolbar__export"
        iconDescription="Export"
        renderIcon={() => (
          <span className="tiptap-toolbar__export-label">
            Export
            <ChevronDown size={14} aria-hidden />
          </span>
        )}
      >
        <OverflowMenuItem itemText="Markdown (.md)" onClick={() => onExport("markdown")} />
        <OverflowMenuItem itemText="HTML (.html)" onClick={() => onExport("html")} />
        <OverflowMenuItem itemText="PDF (.pdf)" onClick={() => onExport("pdf")} />
      </OverflowMenu>
      <FileButton
        label={commentsLabel}
        active={commentsOpen}
        onClick={onToggleComments}
        icon={
          <span className="tiptap-toolbar__comments-icon">
            <MessageSquareText size={ICON_SIZE} />
            {commentCount > 0 ? (
              <span className="tiptap-toolbar__comments-badge" aria-hidden="true">
                {commentCount > 99 ? "99+" : commentCount}
              </span>
            ) : null}
          </span>
        }
      />
      {onToggleChat ? (
        <FileButton
          label={chatOpen ? "Hide chat" : "Show chat"}
          active={chatOpen}
          disabled={chatToggleDisabled}
          onClick={onToggleChat}
          icon={<PanelRight size={ICON_SIZE} />}
        />
      ) : null}
    </div>
  );
}

function FileButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  const fullLabel = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      className={[
        "tiptap-toolbar__button",
        active ? "tiptap-toolbar__button--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={fullLabel}
      aria-pressed={active}
      disabled={disabled}
      title={fullLabel}
      // Don't steal focus from the editor when clicked.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
