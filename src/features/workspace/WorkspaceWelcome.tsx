import { ChatBot, DocumentAdd, Edit } from "@carbon/react/icons";

/**
 * The editor-area welcome shown when a workspace has no files — the first-run
 * landing for a fresh starter folder, and the safety net for any empty folder.
 * Replaces the old "choose a file from the sidebar" dead end (there's nothing
 * to choose) with the two ways to start: write a note, or ask the assistant.
 */
export function WorkspaceWelcome({
  onAskAssistant,
  onNewNote,
}: {
  onAskAssistant: () => void;
  onNewNote: () => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome__inner">
        <span className="welcome__mark" aria-hidden="true">
          <Edit size={24} />
        </span>
        <h2 className="welcome__title">Your workspace is ready</h2>
        <p className="welcome__lead">
          This folder is empty. Start a note, or tell the assistant what you'd like to write.
        </p>
        <div className="welcome__actions">
          <button
            type="button"
            className="welcome__action welcome__action--primary"
            onClick={onNewNote}
          >
            <DocumentAdd size={16} aria-hidden="true" />
            <span>New note</span>
          </button>
          <button type="button" className="welcome__action" onClick={onAskAssistant}>
            <ChatBot size={16} aria-hidden="true" />
            <span>Ask the assistant</span>
          </button>
        </div>
      </div>
    </div>
  );
}
