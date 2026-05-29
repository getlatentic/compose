import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChatBot,
  Checkmark,
  Close,
  DataView,
  Document,
  Send,
  StopFilledAlt,
} from "@carbon/react/icons";
import { useWorkspaceStore, harnessCapabilitiesOf } from "../../app/workspaceStore";
import {
  bobRuntimeReadiness,
  type WorkspaceDocumentSuggestion,
} from "../../app/workspaceModel";
import {
  loadLlmThread,
  type LlmContextSnapshotRecord,
  type LlmThreadSnapshot,
} from "../../lib/ipc/llmContextClient";

type ContextAuditState =
  | { status: "idle" }
  | { llmThreadId: string; status: "loading" }
  | { snapshot: LlmThreadSnapshot; status: "ready" }
  | { llmThreadId: string; message: string; status: "error" };

export function ChatPanel() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const acceptSuggestedEdit = useWorkspaceStore((state) => state.acceptSuggestedEdit);
  const cancelActiveBobRun = useWorkspaceStore((state) => state.cancelActiveBobRun);
  const bobAuthStatus = useWorkspaceStore((state) => state.bobAuthStatus);
  const bobInstallStatus = useWorkspaceStore((state) => state.bobInstallStatus);
  const openSettings = useWorkspaceStore((state) => state.openSettings);
  const selectedHarnessId = useWorkspaceStore((state) => state.selectedHarnessId);
  const harnessCatalog = useWorkspaceStore((state) => state.harnessCatalog);
  const rejectSuggestedEdit = useWorkspaceStore((state) => state.rejectSuggestedEdit);
  const sendChatPrompt = useWorkspaceStore((state) => state.sendChatPrompt);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const setChatPrompt = useWorkspaceStore((state) => state.setChatPrompt);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );
  const chatThread = activeWorkspace?.chatThread ?? null;
  const [contextAudit, setContextAudit] = useState<ContextAuditState>({ status: "idle" });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      return;
    }
    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [chatThread?.messages, chatThread?.runState]);

  useEffect(() => {
    setContextAudit({ status: "idle" });
  }, [activeWorkspaceId]);

  if (!activeWorkspaceId || !chatThread) {
    return null;
  }

  const running = chatThread.runState === "starting" || chatThread.runState === "streaming";
  // Availability is capability-driven, not `id === "bob"`. A harness
  // Compose manages a key for needs its CLI + key (the readiness
  // check). Login-managed harnesses (Claude Code, Codex) are available
  // once selected — if one isn't actually set up, the run surfaces that
  // as an error event rather than blocking the box.
  const credentialRequired = harnessCapabilitiesOf(
    harnessCatalog,
    selectedHarnessId,
  ).credentialRequired;
  const assistantReady = credentialRequired
    ? bobRuntimeReadiness(bobAuthStatus, bobInstallStatus)
    : { ready: true, message: "" };
  const canSend = Boolean(chatThread.prompt.trim()) && !running && assistantReady.ready;
  const workspaceId = activeWorkspaceId;

  async function openContextAudit(llmThreadId: string) {
    setContextAudit({ llmThreadId, status: "loading" });
    try {
      const snapshot = await loadLlmThread({ llmThreadId, workspaceId });
      setContextAudit({ snapshot, status: "ready" });
    } catch (error) {
      setContextAudit({
        llmThreadId,
        message: error instanceof Error ? error.message : "Could not load Bob context",
        status: "error",
      });
    }
  }

  async function openAuditDocument(path: string) {
    await selectFile(path);
    setContextAudit({ status: "idle" });
  }

  return (
    <section className="bob-chat-panel" aria-label="Assistant chat">
      <header className="bob-chat-header">
        <div className="bob-chat-header__title">
          <span className="bob-mark">
            <ChatBot size={16} />
          </span>
          <span>Assistant</span>
        </div>
        <span className="bob-chat-header__meta">
          {chatThread.messages.length === 0 ? "New chat" : `${chatThread.messages.length} messages`}
        </span>
      </header>

      <div ref={scrollRef} className="bob-chat-messages">
        {chatThread.messages.length === 0 ? (
          <div className="bob-chat-empty">
            <p className="bob-chat-empty__title">Ask your assistant</p>
            <p>Use the open note or a comment selection as context.</p>
          </div>
        ) : (
          <div className="bob-message-stack">
            {chatThread.messages.map((message) => (
              <article
                className={[
                  "bob-message-row",
                  message.role === "user" ? "bob-message-row--user" : "bob-message-row--assistant",
                ].join(" ")}
                key={message.id}
              >
                {message.role === "assistant" && message.thinking ? (
                  <details className="bob-message-thinking" style={{ marginBlockEnd: "0.25rem" }}>
                    <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "#8d8d8d" }}>
                      Thinking
                    </summary>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "#8d8d8d",
                        whiteSpace: "pre-wrap",
                        marginBlockStart: "0.25rem",
                      }}
                    >
                      {message.thinking}
                    </div>
                  </details>
                ) : null}
                {message.role === "assistant" && message.activity ? (
                  <div className="bob-message-activity">{message.activity}</div>
                ) : null}
                <div className="bob-message-bubble">
                  {message.content || (message.streaming ? "Thinking..." : "")}
                </div>
                {message.suggestions?.length ? (
                  <SuggestionList
                    suggestions={message.suggestions}
                    onAccept={acceptSuggestedEdit}
                    onOpenDocument={(path) => void selectFile(path)}
                    onReject={rejectSuggestedEdit}
                  />
                ) : null}
                {message.llmThreadId ? (
                  <button
                    type="button"
                    className="bob-message-audit"
                    onClick={() => void openContextAudit(message.llmThreadId as string)}
                    title="Inspect stored Bob context"
                  >
                    <DataView size={16} />
                    <span>Context</span>
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>

      <footer className="bob-chat-composer">
        <div className="bob-chat-context-row">
          {chatThread.contextItems.length === 0 ? (
            <span className="bob-chat-context-chip bob-chat-context-chip--empty">
              No context
            </span>
          ) : (
            chatThread.contextItems.map((item) => (
              <span className="bob-chat-context-chip" key={item.id} title={item.label}>
                <Document size={14} />
                <span>{item.kind === "comment" ? "Comment selection" : item.label}</span>
              </span>
            ))
          )}
        </div>

        <div className="bob-chat-input-row">
          <textarea
            aria-label="Message your assistant"
            disabled={running || !assistantReady.ready}
            onChange={(event) => setChatPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                if (canSend) {
                  void sendChatPrompt();
                }
              }
            }}
            placeholder={assistantReady.ready ? "Ask your assistant…" : "Assistant unavailable"}
            rows={1}
            value={chatThread.prompt}
          />
          {running ? (
            <button
              type="button"
              className="bob-chat-send"
              aria-label="Stop"
              onClick={() => void cancelActiveBobRun()}
            >
              <StopFilledAlt size={18} />
            </button>
          ) : (
            <button
              type="button"
              className="bob-chat-send"
              aria-label="Send message"
              disabled={!canSend}
              onClick={() => void sendChatPrompt()}
            >
              <Send size={18} />
            </button>
          )}
        </div>
        {!assistantReady.ready ? (
          <div className="bob-chat-error bob-chat-error--setup">
            <span>{assistantReady.message}</span>
            <button
              type="button"
              className="bob-chat-setup-link"
              onClick={() => openSettings()}
            >
              Set up your assistant →
            </button>
          </div>
        ) : null}
        {chatThread.runError ? <div className="bob-chat-error">{chatThread.runError}</div> : null}
      </footer>
      {contextAudit.status !== "idle" ? (
        <LlmContextAuditDialog
          state={contextAudit}
          onClose={() => setContextAudit({ status: "idle" })}
          onOpenDocument={(path) => void openAuditDocument(path)}
        />
      ) : null}
    </section>
  );
}

function SuggestionList({
  onAccept,
  onOpenDocument,
  onReject,
  suggestions,
}: {
  onAccept: (suggestionId: string) => void;
  onOpenDocument: (path: string) => void;
  onReject: (suggestionId: string) => void;
  suggestions: WorkspaceDocumentSuggestion[];
}) {
  return (
    <div className="bob-suggestion-list" aria-label="Bob suggested edits">
      {suggestions.map((suggestion) => (
        <article className="bob-suggestion" key={suggestion.id}>
          <header className="bob-suggestion__header">
            <div>
              <div className="bob-suggestion__title">{suggestion.title}</div>
              <button
                type="button"
                className="bob-suggestion__path"
                onClick={() => onOpenDocument(suggestion.filePath)}
              >
                {suggestion.filePath}
              </button>
            </div>
            <span
              className={`bob-suggestion__status bob-suggestion__status--${suggestion.status}`}
            >
              {suggestion.status}
            </span>
          </header>

          <div className="bob-suggestion__diff" aria-label="Suggested edit preview">
            <pre className="bob-suggestion__before">{suggestion.originalText || "(empty)"}</pre>
            <pre className="bob-suggestion__after">{suggestion.replacement || "(delete)"}</pre>
          </div>

          {suggestion.statusMessage ? (
            <div className="bob-suggestion__message">{suggestion.statusMessage}</div>
          ) : null}

          <div className="bob-suggestion__actions">
            <button
              type="button"
              className="bob-suggestion__action bob-suggestion__action--accept"
              disabled={suggestion.status !== "pending"}
              onClick={() => onAccept(suggestion.id)}
            >
              <Checkmark size={16} />
              <span>Accept</span>
            </button>
            <button
              type="button"
              className="bob-suggestion__action"
              disabled={suggestion.status !== "pending"}
              onClick={() => onReject(suggestion.id)}
            >
              <Close size={16} />
              <span>Reject</span>
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function LlmContextAuditDialog({
  onClose,
  onOpenDocument,
  state,
}: {
  onClose: () => void;
  onOpenDocument: (path: string) => void;
  state: Exclude<ContextAuditState, { status: "idle" }>;
}) {
  const title =
    state.status === "ready"
      ? state.snapshot.title || state.snapshot.llmThreadId
      : state.llmThreadId;

  return (
    <div className="bob-modal-backdrop">
      <section className="bob-context-audit" role="dialog" aria-modal="true" aria-label="Bob context">
        <header className="bob-context-audit__header">
          <div>
            <div className="bob-context-audit__eyebrow">Bob context</div>
            <h2>{title}</h2>
          </div>
          <button type="button" className="bob-icon-button" aria-label="Close" onClick={onClose}>
            <Close size={18} />
          </button>
        </header>

        {state.status === "loading" ? (
          <div className="bob-context-audit__status">Loading stored context...</div>
        ) : null}

        {state.status === "error" ? (
          <div className="bob-context-audit__error">{state.message}</div>
        ) : null}

        {state.status === "ready" ? (
          <ContextAuditBody snapshot={state.snapshot} onOpenDocument={onOpenDocument} />
        ) : null}
      </section>
    </div>
  );
}

function ContextAuditBody({
  onOpenDocument,
  snapshot,
}: {
  onOpenDocument: (path: string) => void;
  snapshot: LlmThreadSnapshot;
}) {
  return (
    <div className="bob-context-audit__body">
      <div className="bob-context-audit__summary">
        <span>{snapshot.sourceKind}</span>
        {snapshot.sourceId ? <span>{snapshot.sourceId}</span> : null}
        <span>{snapshot.messages.length} messages</span>
        <span>{snapshot.contextItems.length} context items</span>
      </div>

      <section className="bob-context-audit__section" aria-label="Context items">
        <h3>Context</h3>
        {snapshot.contextItems.length === 0 ? (
          <div className="bob-context-audit__empty">No stored context items.</div>
        ) : (
          <div className="bob-context-list">
            {snapshot.contextItems.map((item) => (
              <ContextAuditItem
                item={item}
                key={item.contextItemId}
                onOpenDocument={onOpenDocument}
              />
            ))}
          </div>
        )}
      </section>

      <section className="bob-context-audit__section" aria-label="Stored messages">
        <h3>Messages</h3>
        <div className="bob-context-message-list">
          {snapshot.messages.map((message) => (
            <article className="bob-context-message" key={message.llmMessageId}>
              <div className="bob-context-message__role">{message.role}</div>
              <pre>{message.body}</pre>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ContextAuditItem({
  item,
  onOpenDocument,
}: {
  item: LlmContextSnapshotRecord;
  onOpenDocument: (path: string) => void;
}) {
  const byteRange = item.sourceRange
    ? `bytes ${item.sourceRange.start}-${item.sourceRange.end}`
    : "whole document";
  const anchorState = item.anchor?.resolution ? `anchor ${item.anchor.resolution}` : null;

  return (
    <article className="bob-context-item">
      <div className="bob-context-item__header">
        <div>
          <div className="bob-context-item__path">{item.currentPath ?? "Document metadata missing"}</div>
          <div className="bob-context-item__meta">
            <span>{byteRange}</span>
            {anchorState ? <span>{anchorState}</span> : null}
            {item.documentRevisionId ? <span>revision {item.documentRevisionId}</span> : null}
          </div>
        </div>
        {item.currentPath ? (
          <button
            type="button"
            className="bob-context-item__open"
            onClick={() => onOpenDocument(item.currentPath as string)}
          >
            Open document
          </button>
        ) : null}
      </div>

      {item.selectedTextSnapshot ? (
        <blockquote className="bob-context-item__selection">{item.selectedTextSnapshot}</blockquote>
      ) : null}

      {item.surroundingContextSnapshot ? (
        <pre className="bob-context-item__surrounding">{item.surroundingContextSnapshot}</pre>
      ) : null}
    </article>
  );
}
