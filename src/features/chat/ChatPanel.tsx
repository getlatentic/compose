import { useMemo, useState } from "react";
import { ChatBot } from "@carbon/react/icons";

import { harnessCapabilitiesOf, useWorkspaceStore } from "../../app/workspaceStore";
import { bobRuntimeReadiness, sumChatThreadStats } from "../../app/workspaceModel";
import { formatCoins, formatCompact } from "../../lib/format/numbers";
import { exportMarkdownFile } from "../../lib/export/markdownExport";
import { conversationToMarkdown } from "../../lib/export/conversationMarkdown";
import { loadConversation } from "../../lib/ipc/conversationsClient";
import { ChatMessageList } from "./ChatMessageList";
import type { MessageRowCallbacks } from "./MessageRow";
import { MessageComposer } from "./MessageComposer";
import { ConversationActionsMenu } from "./ConversationActionsMenu";
import { ConversationTitleEditor } from "./ConversationTitleEditor";
import { ConversationDeleteToast } from "./ConversationDeleteToast";

/**
 * The assistant chat surface. A thin orchestrator: it reads the active
 * workspace's chat thread, conversation history, and harness capabilities
 * from the store, derives availability, and wires the transcript
 * ([ChatMessageList](ChatMessageList.tsx)) and the composer
 * ([MessageComposer](MessageComposer.tsx)). The header hosts only the
 * inline-editable title + the ⋮ actions menu for the open conversation —
 * switching conversations and starting new ones live in the sidebar Chat tab
 * now, so this panel no longer owns a history dropdown or an
 * all-conversations overlay. The post-delete undo toast layers over the panel.
 * All conversation-management state lives in the store.
 */
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
  const conversationsByWorkspace = useWorkspaceStore((state) => state.conversations);
  const renameConversation = useWorkspaceStore((state) => state.renameConversation);
  const archiveConversation = useWorkspaceStore((state) => state.archiveConversation);
  const deleteConversation = useWorkspaceStore((state) => state.deleteConversation);
  const undoDeleteConversation = useWorkspaceStore((state) => state.undoDeleteConversation);
  const duplicateConversation = useWorkspaceStore((state) => state.duplicateConversation);
  const deleteNotice = useWorkspaceStore((state) => state.conversationDeleteNotice);

  const [editingTitle, setEditingTitle] = useState(false);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );
  const chatThread = activeWorkspace?.chatThread ?? null;

  const callbacks = useMemo<MessageRowCallbacks>(
    () => ({
      onAccept: acceptSuggestedEdit,
      onOpenDocument: (path) => void selectFile(path),
      onReject: rejectSuggestedEdit,
    }),
    [acceptSuggestedEdit, rejectSuggestedEdit, selectFile],
  );

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

  // The file currently attached as context (the open note) — named in the
  // empty state's "I can already see …" line and the "Mentions" filter.
  const contextFileLabel =
    chatThread.contextItems.find((item) => item.kind === "file")?.label ?? null;

  const conversations = conversationsByWorkspace[activeWorkspaceId] ?? [];
  const openConversationId = chatThread.conversationId;
  const openSummary =
    conversations.find((item) => item.conversationId === openConversationId) ?? null;
  const openTitle = openSummary?.title ?? "New conversation";

  // Header total: the thread's cumulative token + coin usage (compact,
  // human-readable), not a message count. "New chat" until anything's run.
  const totals = sumChatThreadStats(chatThread);
  const headerMeta =
    totals.totalTokens || totals.coins
      ? [
          totals.totalTokens ? `${formatCompact(totals.totalTokens)} tokens` : null,
          totals.coins ? `${formatCoins(totals.coins)} coins` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "New chat";

  // Export the open conversation: prefer the live thread (it has the latest
  // in-flight turns), else fall back to the persisted snapshot.
  const exportConversation = async (conversationId: string, title: string) => {
    if (!window.confirm(`Export “${title}” as a Markdown file?`)) {
      return;
    }
    let messages: { role: "user" | "assistant"; content: string }[];
    if (chatThread.conversationId === conversationId) {
      messages = chatThread.messages;
    } else {
      const snapshot = await loadConversation(activeWorkspaceId, conversationId).catch(() => null);
      if (!snapshot) {
        return;
      }
      messages = snapshot.messages;
    }
    exportMarkdownFile({
      filePath: title || "conversation",
      markdown: conversationToMarkdown(title, messages),
    });
  };

  return (
    <section className="bob-chat-panel" aria-label="Assistant chat">
      <header className="bob-chat-header">
        <div className="bob-chat-header__title">
          <span className="bob-mark">
            <ChatBot size={16} />
          </span>
          {editingTitle && openConversationId ? (
            <ConversationTitleEditor
              initialTitle={openSummary?.title ?? ""}
              onCommit={(title) => {
                setEditingTitle(false);
                void renameConversation(openConversationId, title || null);
              }}
              onCancel={() => setEditingTitle(false)}
            />
          ) : openConversationId ? (
            // The open conversation's title — click to rename in place. Switching
            // and starting conversations now live in the sidebar Chat tab.
            <button
              type="button"
              className="bob-chat-header__title-button"
              title="Rename conversation"
              onClick={() => setEditingTitle(true)}
            >
              {openTitle}
            </button>
          ) : (
            <span className="bob-chat-header__title-text">{openTitle}</span>
          )}
        </div>
        <div className="bob-chat-header__actions">
          <span className="bob-chat-header__meta" title="Total token and coin usage this chat">
            {headerMeta}
          </span>
          {openConversationId && openSummary ? (
            <ConversationActionsMenu
              archived={openSummary.archived}
              actions={{
                onRename: () => setEditingTitle(true),
                onDuplicate: () => void duplicateConversation(openConversationId),
                onExport: () => void exportConversation(openConversationId, openTitle),
                onArchive: () =>
                  void archiveConversation(openConversationId, !openSummary.archived),
                onDelete: () => deleteConversation(openConversationId),
              }}
            />
          ) : null}
        </div>
      </header>

      <ChatMessageList
        callbacks={callbacks}
        contextFileLabel={contextFileLabel}
        messages={chatThread.messages}
        onUseSuggestion={setChatPrompt}
        runState={chatThread.runState}
      />

      {deleteNotice && deleteNotice.workspaceId === activeWorkspaceId ? (
        <ConversationDeleteToast
          title={deleteNotice.title}
          onUndo={() => undoDeleteConversation(deleteNotice.conversationId)}
        />
      ) : null}

      <MessageComposer
        assistantReady={assistantReady}
        canSend={canSend}
        contextItems={chatThread.contextItems}
        onOpenSettings={openSettings}
        onPromptChange={setChatPrompt}
        onSend={() => void sendChatPrompt()}
        onStop={() => void cancelActiveBobRun()}
        prompt={chatThread.prompt}
        runError={chatThread.runError}
        running={running}
      />
    </section>
  );
}
