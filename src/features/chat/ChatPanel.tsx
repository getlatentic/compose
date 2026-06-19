import { memo, useMemo, useState } from "react";
import { Add, Close } from "@carbon/react/icons";

import { harnessCapabilitiesOf, useWorkspaceStore } from "../../app/workspaceStore";
import { useUiStore } from "../../app/store/uiStore";
import { useHarnessStore } from "../../app/store/harnessStore";
import { sumChatThreadStats } from "../../app/workspaceModel";
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
function ChatPanelInner() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const acceptSuggestedEdit = useWorkspaceStore((state) => state.acceptSuggestedEdit);
  const cancelActiveRun = useWorkspaceStore((state) => state.cancelActiveRun);
  const selectedHarnessReadiness = useHarnessStore((state) => state.selectedHarnessReadiness);
  const openSettings = useUiStore((state) => state.openSettings);
  const selectedHarnessId = useHarnessStore((state) => state.selectedHarnessId);
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const rejectSuggestedEdit = useWorkspaceStore((state) => state.rejectSuggestedEdit);
  const regenerateLastTurn = useWorkspaceStore((state) => state.regenerateLastTurn);
  const sendChatPrompt = useWorkspaceStore((state) => state.sendChatPrompt);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const setChatPrompt = useWorkspaceStore((state) => state.setChatPrompt);
  // Narrow selector: the chat panel only needs the active workspace's
  // chat thread, NOT the whole `workspaces` array. The store preserves
  // `chatThread`'s reference when other workspace fields change (e.g. a
  // buffer-content edit spreads `{...ws, fileContents}`, leaving
  // `chatThread` identical), so editing a note no longer re-renders the
  // chat panel — only a real chat change (token, conversation switch)
  // produces a new `chatThread` reference. (See the re-render-cascade
  // investigation: AppShell + ChatPanel both used to read all workspaces.)
  const chatThread = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return ws?.chatThread ?? null;
  });
  const conversationsByWorkspace = useWorkspaceStore((state) => state.conversations);
  const renameConversation = useWorkspaceStore((state) => state.renameConversation);
  const archiveConversation = useWorkspaceStore((state) => state.archiveConversation);
  const deleteConversation = useWorkspaceStore((state) => state.deleteConversation);
  const undoDeleteConversation = useWorkspaceStore((state) => state.undoDeleteConversation);
  const duplicateConversation = useWorkspaceStore((state) => state.duplicateConversation);
  const newChat = useWorkspaceStore((state) => state.newChat);
  const toggleChat = useUiStore((state) => state.toggleChat);
  const deleteNotice = useWorkspaceStore((state) => state.conversationDeleteNotice);

  const [editingTitle, setEditingTitle] = useState(false);

  const callbacks = useMemo<MessageRowCallbacks>(
    () => ({
      onAccept: acceptSuggestedEdit,
      onOpenDocument: (path) => void selectFile(path),
      onReject: rejectSuggestedEdit,
      onRegenerate: () => void regenerateLastTurn(),
    }),
    [acceptSuggestedEdit, rejectSuggestedEdit, regenerateLastTurn, selectFile],
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
    ? { ready: selectedHarnessReadiness?.ready ?? false, message: selectedHarnessReadiness?.error ?? null }
    : { ready: true, message: null };
  const canSend = Boolean(chatThread.prompt.trim()) && !running && assistantReady.ready;

  // The file currently attached as context (the open note) — named in the
  // empty state's "I can already see …" line and the "Mentions" filter.
  const contextFileLabel =
    chatThread.contextItems.find((item) => item.kind === "file")?.label ?? null;

  const conversations = conversationsByWorkspace[activeWorkspaceId] ?? [];
  const openConversationId = chatThread.conversationId;
  const openSummary =
    conversations.find((item) => item.conversationId === openConversationId) ?? null;
  // Title is the open conversation's name; when nothing's open we deliberately
  // render NO title — the `+ × ⋮` actions already say "this is the chat panel."
  // A "New chat" / "New conversation" placeholder competed with the `+` button
  // and made it look like two buttons for the same action.
  const openTitle = openSummary?.title ?? null;

  // Header total: the thread's cumulative token + coin usage (compact,
  // human-readable), not a message count. Empty until anything's run — no
  // placeholder, for the same reason the title is empty.
  const totals = sumChatThreadStats(chatThread);
  const headerMeta =
    totals.totalTokens || totals.coins
      ? [
          totals.totalTokens ? `${formatCompact(totals.totalTokens)} tokens` : null,
          totals.coins ? `${formatCoins(totals.coins)} coins` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

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
    <section className="chat-panel" aria-label="Assistant chat">
      <header className="chat-header">
        <div className="chat-header__title">
          {/* No mark / "Assistant" prefix and no "New chat" placeholder
              when there's no open conversation — the panel itself + the action
              buttons already say "this is the assistant." We only show a title
              when there IS one (the user's named conversation). */}
          {editingTitle && openConversationId ? (
            <ConversationTitleEditor
              initialTitle={openSummary?.title ?? ""}
              onCommit={(title) => {
                setEditingTitle(false);
                void renameConversation(openConversationId, title || null);
              }}
              onCancel={() => setEditingTitle(false)}
            />
          ) : openConversationId && openTitle ? (
            // The open conversation's title — click to rename in place.
            <button
              type="button"
              className="chat-header__title-button"
              title="Rename conversation"
              onClick={() => setEditingTitle(true)}
            >
              {openTitle}
            </button>
          ) : null}
        </div>
        <div className="chat-header__actions">
          {headerMeta ? (
            <span className="chat-header__meta" title="Total token and coin usage this chat">
              {headerMeta}
            </span>
          ) : null}
          {/* + = start a fresh conversation in this panel. × = close the panel
              (same effect as the editor toolbar's PanelRight toggle). ⋮ =
              per-conversation actions (rename / duplicate / export / archive /
              delete) — only when a conversation is actually open. */}
          <button
            type="button"
            className="chat-header__btn"
            aria-label="New chat"
            title="New chat"
            onClick={() => void newChat()}
          >
            <Add size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="chat-header__btn"
            aria-label="Close chat"
            title="Close chat"
            onClick={toggleChat}
          >
            <Close size={16} aria-hidden />
          </button>
          {openConversationId && openSummary ? (
            <ConversationActionsMenu
              archived={openSummary.archived}
              actions={{
                onRename: () => setEditingTitle(true),
                onDuplicate: () => void duplicateConversation(openConversationId),
                onExport: () =>
                  void exportConversation(openConversationId, openTitle ?? "conversation"),
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
        onStop={() => void cancelActiveRun()}
        prompt={chatThread.prompt}
        runError={chatThread.runError}
        running={running}
      />
    </section>
  );
}

/**
 * Memoised + no props → re-renders only when the chat panel's own store
 * subscriptions change (chat thread, conversations, harness/auth state),
 * not when AppShell re-renders for an unrelated reason (e.g. a note edit).
 */
export const ChatPanel = memo(ChatPanelInner);
