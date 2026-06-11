import { useEffect, useRef, type KeyboardEvent } from "react";
import { Document, Send, StopFilledAlt } from "@carbon/react/icons";

import type { BobRuntimeReadiness, WorkspaceContextItem } from "../../app/workspaceModel";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { ChatComposerFooter } from "./ChatComposerFooter";
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

  // Imperative focus: the store bumps `composerFocusNonce` to ask us to focus
  // the input (e.g. the empty-folder "Ask the assistant" button). We focus on
  // every change *after* mount — the ref to skip the initial value keeps a
  // fresh load from stealing focus into the composer.
  const composerFocusNonce = useWorkspaceStore((state) => state.composerFocusNonce);
  const lastFocusNonce = useRef(composerFocusNonce);
  useEffect(() => {
    if (composerFocusNonce === lastFocusNonce.current) {
      return;
    }
    lastFocusNonce.current = composerFocusNonce;
    const element = textareaRef.current;
    if (element && !element.disabled) {
      element.focus();
    }
  }, [composerFocusNonce, textareaRef]);

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

      {!assistantReady.ready ? (
        <div className="bob-chat-error bob-chat-error--setup">
          <span>{assistantReady.message}</span>
          <button type="button" className="bob-chat-setup-link" onClick={onOpenSettings}>
            Set up your assistant →
          </button>
        </div>
      ) : null}
      {runError ? <div className="bob-chat-error">{runError}</div> : null}

      {/* The compact footer line: assistant + model selectors, token count,
          and the send hint. Switches the harness from chat (like a model
          picker). Hidden in the browser preview (no catalog); disabled
          mid-run. */}
      <ChatComposerFooter disabled={running} />
    </footer>
  );
}
