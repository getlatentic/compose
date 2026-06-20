import { useEffect, useRef, useState } from "react";

/**
 * Inline editor for a conversation's title. Rendered in place of the history
 * trigger while the header title is being edited (started by the ⋮ Rename or
 * a double-click). Commits on Enter or blur, cancels on Escape, and guards
 * against the double-fire of Escape-then-blur with a one-shot latch so a
 * cancel never also commits.
 */
export function ConversationTitleEditor({
  initialTitle,
  onCommit,
  onCancel,
}: {
  initialTitle: string;
  /** Receives the trimmed title (may be empty → clears to the derived one). */
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const settle = (run: () => void) => {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    run();
  };

  // Only persist a real edit. Opening the field and clicking away (or pressing
  // Enter) without changing anything must NOT write the current title back —
  // otherwise the "New conversation" placeholder gets saved as an explicit
  // title and blocks the first-message-derived name.
  const commit = () => {
    const trimmed = value.trim();
    if (trimmed === initialTitle.trim()) {
      onCancel();
    } else {
      onCommit(trimmed);
    }
  };

  return (
    <input
      ref={inputRef}
      className="conv-title-input"
      value={value}
      aria-label="Conversation title"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          settle(commit);
        } else if (event.key === "Escape") {
          event.preventDefault();
          settle(onCancel);
        }
      }}
      onBlur={() => settle(commit)}
    />
  );
}
