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
          settle(() => onCommit(value.trim()));
        } else if (event.key === "Escape") {
          event.preventDefault();
          settle(onCancel);
        }
      }}
      onBlur={() => settle(() => onCommit(value.trim()))}
    />
  );
}
