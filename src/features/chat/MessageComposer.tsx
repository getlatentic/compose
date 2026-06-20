import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { Close, Document, Send, StopFilledAlt } from "@carbon/react/icons";

import type { WorkspaceContextItem } from "../../app/workspaceModel";
import { useUiStore } from "../../app/store/uiStore";
import {
  pastedTextChipLabel,
  shouldSpillChatInput,
} from "../../app/store/chatInputSpill";
import { spillChatInput } from "../../lib/ipc/harnessClient";
import { ChatComposerFooter } from "./ChatComposerFooter";
import { ChatErrorNotice } from "./ChatErrorNotice";
import { useAutoGrowTextarea } from "./useAutoGrowTextarea";

/** Whether the chat can be sent right now, with a message to show when it
 * can't (drives the composer's setup notice + the disabled placeholder). */
export interface AssistantReadiness {
  ready: boolean;
  message: string | null;
}

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
  harnessName,
  onAddFileContext,
  onHeightChange,
  onOpenSettings,
  onPromptChange,
  onRemoveContextItem,
  onRetry,
  onSend,
  onStop,
  prompt,
  runError,
  running,
  tokenLabel,
  workspaceId,
}: {
  assistantReady: AssistantReadiness;
  canSend: boolean;
  contextItems: WorkspaceContextItem[];
  /** The selected harness's display name, for the friendly error summary. */
  harnessName: string;
  /** Attach a spilled paste as a file context chip. */
  onAddFileContext: (input: { label: string; path: string }) => void;
  /** Live composer height (px), reported on mount and every resize so the
   * transcript can reserve matching bottom space and re-pin to bottom. */
  onHeightChange: (height: number) => void;
  onOpenSettings: () => void;
  onPromptChange: (value: string) => void;
  /** Remove a context chip by id (the chip's ✕). */
  onRemoveContextItem: (id: string) => void;
  /** Re-probe harness readiness after a failure (the error banner's Retry). */
  onRetry: () => void;
  onSend: () => void;
  onStop: () => void;
  prompt: string;
  runError: string | null;
  running: boolean;
  /** Cumulative token usage for the conversation, shown above the input. */
  tokenLabel: string | null;
  /** Active workspace id — the scratch namespace for a spilled paste. */
  workspaceId: string;
}) {
  const textareaRef = useAutoGrowTextarea(prompt);
  const composerRef = useRef<HTMLElement>(null);

  // Keep `onHeightChange` in a ref so the observer below doesn't re-subscribe
  // when the parent passes a fresh callback identity.
  const onHeightChangeRef = useRef(onHeightChange);
  onHeightChangeRef.current = onHeightChange;

  // The composer floats over the transcript: it's absolutely pinned to the
  // panel's bottom edge so a growing textarea moves its TOP edge up (rather
  // than shrinking the message area). The composer's live height is published
  // two ways from the same measurement: as `--chat-composer-block` (the
  // floating undo toast offsets above it) and through `onHeightChange` (the
  // transcript renders a matching end spacer and re-pins to bottom), so the
  // last message can always scroll clear and the messages pass *under* the
  // composer as they scroll.
  useLayoutEffect(() => {
    const element = composerRef.current;
    const panel = element?.closest<HTMLElement>(".chat-panel");
    if (!element || !panel) {
      return;
    }
    const sync = () => {
      const height = element.offsetHeight;
      panel.style.setProperty("--chat-composer-block", `${height}px`);
      onHeightChangeRef.current(height);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Imperative focus: the store bumps `composerFocusNonce` to ask us to focus
  // the input (e.g. the empty-folder "Ask the assistant" button). We focus on
  // every change *after* mount — the ref to skip the initial value keeps a
  // fresh load from stealing focus into the composer.
  const composerFocusNonce = useUiStore((state) => state.composerFocusNonce);
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

  // A large paste doesn't belong inline — it would bury the prompt and (for a
  // small model) blow the context window. Spill it to a scratch file and attach
  // that as a context chip instead, so it flows through the budgeted file-context
  // path (read on demand). A normal-sized paste falls through to the default.
  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData("text");
    if (!shouldSpillChatInput(pasted)) {
      return;
    }
    event.preventDefault();
    void spillChatInput(workspaceId, pasted)
      .then((path) => onAddFileContext({ label: pastedTextChipLabel(pasted), path }))
      .catch(() => {
        // Spill unavailable (e.g. browser preview): fall back to inserting the
        // text inline rather than silently dropping the user's paste.
        onPromptChange(prompt + pasted);
      });
  }

  return (
    <footer className="chat-composer" ref={composerRef}>
      {/* Notices sit at the TOP of the composer — above the context — so a run
          failure or a needs-setup harness reads first and never shifts the
          input or footer. Both render the compact friendly banner (short
          summary + Retry + Details disclosure of the raw text). A not-ready
          harness additionally offers a Set-up link to Settings. */}
      {runError ? (
        <ChatErrorNotice raw={runError} harnessName={harnessName} onRetry={onRetry} />
      ) : null}
      {!assistantReady.ready ? (
        <ChatErrorNotice
          raw={assistantReady.message ?? ""}
          harnessName={harnessName}
          onRetry={onRetry}
          onOpenSettings={onOpenSettings}
        />
      ) : null}

      <div className="chat-context-row">
        {contextItems.length === 0 ? (
          <span className="chat-context-chip chat-context-chip--empty">No context</span>
        ) : (
          contextItems.map((item) => (
            <span className="chat-context-chip" key={item.id} title={item.label}>
              <Document size={14} />
              <span>{item.kind === "comment" ? "Comment selection" : item.label}</span>
              <button
                type="button"
                className="chat-context-chip__remove"
                aria-label={`Remove ${item.label}`}
                onClick={() => onRemoveContextItem(item.id)}
              >
                <Close size={12} />
              </button>
            </span>
          ))
        )}
        {tokenLabel ? <span className="chat-tokens">{tokenLabel}</span> : null}
      </div>

      {/* The textarea and the send/stop control share ONE bordered surface so
          the input reads as a single field, not a textbox island floating on a
          differently-coloured strip. */}
      <div className="chat-input-field">
        <textarea
          ref={textareaRef}
          aria-label="Message your assistant"
          disabled={running || !assistantReady.ready}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={assistantReady.ready ? "Ask your assistant…" : "Assistant unavailable"}
          rows={1}
          value={prompt}
        />
        {running ? (
          <button type="button" className="chat-send" aria-label="Stop" onClick={onStop}>
            <StopFilledAlt size={18} />
          </button>
        ) : (
          <button
            type="button"
            className="chat-send"
            aria-label="Send message"
            disabled={!canSend}
            onClick={onSend}
          >
            <Send size={18} />
          </button>
        )}
      </div>

      {/* The compact footer line: assistant + model selectors, token count,
          and the send hint. Switches the harness from chat (like a model
          picker). Hidden in the browser preview (no catalog); disabled
          mid-run. */}
      <ChatComposerFooter disabled={running} />
    </footer>
  );
}
