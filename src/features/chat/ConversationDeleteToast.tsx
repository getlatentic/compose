import { Undo } from "@carbon/react/icons";

/**
 * The post-delete undo toast. A deleted conversation leaves the list
 * immediately; this surfaces a brief "Deleted · Undo" affordance whose
 * Undo cancels the still-pending soft-delete (see `deleteConversation` /
 * `undoDeleteConversation` in the store). Purely presentational.
 */
export function ConversationDeleteToast({
  title,
  onUndo,
}: {
  title: string;
  onUndo: () => void;
}) {
  return (
    <div className="conv-toast" role="status" aria-live="polite">
      <span className="conv-toast__text">
        Deleted <strong>{title}</strong>
      </span>
      <button type="button" className="conv-toast__undo" onClick={onUndo}>
        <Undo size={14} aria-hidden />
        <span>Undo</span>
      </button>
    </div>
  );
}
