import { ChatBot, DocumentAdd, Folder } from "@carbon/react/icons";
import { ComposeMark } from "../setup/ComposeMark";

/**
 * The editor-area empty-state card, shown whenever no document is in view —
 * either the folder has no notes yet (the first-run landing for a fresh starter
 * folder) or every tab is closed. Replaces the old "choose a file from the
 * sidebar" dead end with the ways forward: write a note, open an existing
 * folder, or ask the assistant. The caller supplies the copy — title, optional
 * lead, the primary button's label, and an optional open-folder action — so it
 * speaks to the specific state.
 */
export function WorkspaceWelcome({
  title,
  lead,
  newNoteLabel = "New note",
  onOpenFolder,
  onAskAssistant,
  onNewNote,
}: {
  title: string;
  lead?: string;
  newNoteLabel?: string;
  /** When set, an "Open folder" button appears — opens an existing folder as a
   * workspace. Omitted where it doesn't apply (e.g. the browser preview). */
  onOpenFolder?: () => void;
  onAskAssistant: () => void;
  onNewNote: () => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome__inner">
        <span className="welcome__mark" aria-hidden="true">
          <ComposeMark size={28} />
        </span>
        <h2 className="welcome__title">{title}</h2>
        {lead ? <p className="welcome__lead">{lead}</p> : null}
        <div className="welcome__actions">
          <button
            type="button"
            className="welcome__action welcome__action--primary"
            onClick={onNewNote}
          >
            <DocumentAdd size={16} aria-hidden="true" />
            <span>{newNoteLabel}</span>
          </button>
          {onOpenFolder ? (
            <button type="button" className="welcome__action" onClick={onOpenFolder}>
              <Folder size={16} aria-hidden="true" />
              <span>Open folder</span>
            </button>
          ) : null}
          <button type="button" className="welcome__action" onClick={onAskAssistant}>
            <ChatBot size={16} aria-hidden="true" />
            <span>Ask the assistant</span>
          </button>
        </div>
      </div>
    </div>
  );
}
