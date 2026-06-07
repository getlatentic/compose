import type { KeyboardEvent } from "react";
import { Document, Send, StopFilledAlt } from "@carbon/react/icons";

import type { BobRuntimeReadiness, WorkspaceContextItem } from "../../app/workspaceModel";
import { ChatHarnessPicker } from "./ChatHarnessPicker";
import { useAutoGrowTextarea } from "./useAutoGrowTextarea";

/**
 * The chat footer: the context chips, the auto-growing prompt textarea,
 * and the send / stop control, plus the setup and run-error notices.
 *
 * Keyboard model (conventional chat UX): **Enter sends**, **Shift+Enter**
 * inserts a newline. A send is suppressed while an IME composition is in
 * flight so committing a character with Enter doesn't fire the prompt.
 */
export function MessageComposer({
  assistantReady,
  canSend,
  contextItems,
  onOpenSettings,
  onPromptChange,
  onSend,
  onStop,
  prompt,
  runError,
  running,
}: {
  assistantReady: BobRuntimeReadiness;
  canSend: boolean;
  contextItems: WorkspaceContextItem[];
  onOpenSettings: () => void;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  prompt: string;
  runError: string | null;
  running: boolean;
}) {
  const textareaRef = useAutoGrowTextarea(prompt);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    // Mid-IME-composition Enter commits the candidate; it must not send.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }
    event.preventDefault();
    if (canSend) {
      onSend();
    }
  }

  return (
    <footer className="bob-chat-composer">
      <div className="bob-chat-context-row">
        {contextItems.length === 0 ? (
          <span className="bob-chat-context-chip bob-chat-context-chip--empty">No context</span>
        ) : (
          contextItems.map((item) => (
            <span className="bob-chat-context-chip" key={item.id} title={item.label}>
              <Document size={14} />
              <span>{item.kind === "comment" ? "Comment selection" : item.label}</span>
            </span>
          ))
        )}
      </div>

      <div className="bob-chat-input-row">
        <textarea
          ref={textareaRef}
          aria-label="Message your assistant"
          disabled={running || !assistantReady.ready}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={assistantReady.ready ? "Ask your assistant…" : "Assistant unavailable"}
          rows={1}
          value={prompt}
        />
        {running ? (
          <button type="button" className="bob-chat-send" aria-label="Stop" onClick={onStop}>
            <StopFilledAlt size={18} />
          </button>
        ) : (
          <button
            type="button"
            className="bob-chat-send"
            aria-label="Send message"
            disabled={!canSend}
            onClick={onSend}
          >
            <Send size={18} />
          </button>
        )}
      </div>

      {/* Switch the active harness from the chat, like a model picker.
          Hidden in the browser preview; disabled mid-run. */}
      <ChatHarnessPicker disabled={running} />

      {!assistantReady.ready ? (
        <div className="bob-chat-error bob-chat-error--setup">
          <span>{assistantReady.message}</span>
          <button type="button" className="bob-chat-setup-link" onClick={onOpenSettings}>
            Set up your assistant →
          </button>
        </div>
      ) : null}
      {runError ? <div className="bob-chat-error">{runError}</div> : null}
    </footer>
  );
}
