import { memo, useCallback, useMemo, useState } from "react";
import { Add, Close } from "@carbon/react/icons";

import { useWorkspaceStore } from "../../app/workspaceStore";
import { useUiStore } from "../../app/store/uiStore";
import { useHarnessStore } from "../../app/store/harnessStore";
import { harnessInstall, startOllama } from "../../lib/ipc/harnessClient";
import { agentStatus } from "../settings/agentStatus";
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
  const reloadSelectedHarnessReadiness = useHarnessStore(
    (state) => state.reloadSelectedHarnessReadiness,
  );
  const openSettings = useUiStore((state) => state.openSettings);
  const selectedHarnessId = useHarnessStore((state) => state.selectedHarnessId);
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const rejectSuggestedEdit = useWorkspaceStore((state) => state.rejectSuggestedEdit);
  const regenerateLastTurn = useWorkspaceStore((state) => state.regenerateLastTurn);
  const sendChatPrompt = useWorkspaceStore((state) => state.sendChatPrompt);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const setChatPrompt = useWorkspaceStore((state) => state.setChatPrompt);
  const addChatFileContext = useWorkspaceStore((state) => state.addChatFileContext);
  const removeChatContextItem = useWorkspaceStore((state) => state.removeChatContextItem);
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
  // Live height of the floating composer, measured by `MessageComposer`. The
  // transcript reserves matching bottom space and re-pins to bottom off it, so
  // the last turn always clears the composer. Seeded near the resting height
  // (~9rem) so the first paint reserves sensibly before measurement lands.
  const [composerHeight, setComposerHeight] = useState(144);

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
  // Availability is readiness-driven for every harness: picking one that needs
  // setup (a key, a sign-in, an install) prompts you to configure it right here
  // instead of letting a doomed run fail. Conservative — only a *definitive*
  // not-ready readiness blocks; a not-yet-probed (null) selection stays
  // available, so a slow or failed probe never wrongly locks the composer (the
  // send-time credential preflight still backstops key-managed harnesses).
  const selectedInfo = harnessCatalog.find((entry) => entry.id === selectedHarnessId);
  const selectedHarnessName = selectedInfo?.displayName ?? "Your assistant";
  // A CLI agent that isn't on disk yet → offer a one-click install right here
  // (it runs on the bundled npm), instead of sending the user off to Settings.
  const needsInstall =
    !!selectedInfo && agentStatus(selectedInfo, selectedHarnessReadiness).action === "install";
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const installSelected = useCallback(async () => {
    if (!selectedHarnessId) return;
    setInstalling(true);
    setInstallError(null);
    try {
      for await (const event of harnessInstall(selectedHarnessId)) {
        if (event.kind === "done" && !event.ok) {
          setInstallError(`Couldn't set up ${selectedHarnessName}. Open Settings for details.`);
        }
      }
    } catch (error) {
      setInstallError(
        error instanceof Error ? error.message : `Couldn't set up ${selectedHarnessName}.`,
      );
    } finally {
      setInstalling(false);
      void reloadSelectedHarnessReadiness();
    }
  }, [selectedHarnessId, selectedHarnessName, reloadSelectedHarnessReadiness]);

  // Ollama isn't a CLI we install — it's a local app that may just be stopped.
  // Offer a one-click start (launches the app, which boots its server) and then
  // re-probe; the brief pause gives the server a moment to accept connections.
  const [startingOllama, setStartingOllama] = useState(false);
  const [startOllamaError, setStartOllamaError] = useState<string | null>(null);
  const startSelectedOllama = useCallback(async () => {
    setStartingOllama(true);
    setStartOllamaError(null);
    try {
      await startOllama();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      setStartOllamaError(error instanceof Error ? error.message : "Couldn't start Ollama.");
    } finally {
      setStartingOllama(false);
      void reloadSelectedHarnessReadiness();
    }
  }, [reloadSelectedHarnessReadiness]);
  const needsOllamaStart =
    selectedHarnessId === "ollama" &&
    !!selectedHarnessReadiness &&
    !selectedHarnessReadiness.ready &&
    !needsInstall;

  const assistantReady = !selectedHarnessId
    ? { ready: false, message: "Set up an AI agent in Settings to start chatting." }
    : selectedHarnessReadiness && !selectedHarnessReadiness.ready
      ? {
          ready: false,
          message:
            selectedHarnessReadiness.error ??
            `${selectedHarnessName} needs setup before you can use it.`,
        }
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
  //
  // The summary's title lags: the history list refreshes asynchronously after a
  // send, so a freshly-titled conversation reads back as the "New conversation"
  // placeholder until that lands. Fall back to deriving the title from the
  // thread's own first user message (already on screen), so the header is
  // correct immediately rather than stuck on "New conversation".
  const derivedTitle =
    chatThread.messages.find((message) => message.role === "user")?.content.trim().slice(0, 60) ||
    null;
  const openTitle =
    openSummary && openSummary.title !== "New conversation"
      ? openSummary.title
      : derivedTitle ?? openSummary?.title ?? null;

  // Header total: the thread's cumulative token + coin usage (compact,
  // human-readable), not a message count. Empty until anything's run — no
  // placeholder, for the same reason the title is empty.
  const totals = sumChatThreadStats(chatThread);
  const tokenLabel = totals.totalTokens ? `${formatCompact(totals.totalTokens)} tokens` : null;
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
        composerHeight={composerHeight}
        contextFileLabel={contextFileLabel}
        messages={chatThread.messages}
        onUseSuggestion={(text, opts) => {
          setChatPrompt(text);
          // Read-only-intent suggestions (Summarize / Key points) send in
          // read-only mode — the harness refuses any write, so they can't change
          // files. Type the request manually for an editable run.
          if (opts?.readOnly) {
            void sendChatPrompt({ readOnly: true });
          }
        }}
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
        harnessName={selectedHarnessName}
        onAddFileContext={addChatFileContext}
        onHeightChange={setComposerHeight}
        onOpenSettings={() => openSettings(selectedHarnessId || undefined)}
        onInstall={needsInstall ? () => void installSelected() : undefined}
        installing={installing}
        installError={installError}
        onStartOllama={needsOllamaStart ? () => void startSelectedOllama() : undefined}
        startingOllama={startingOllama}
        startOllamaError={startOllamaError}
        onPromptChange={setChatPrompt}
        onRemoveContextItem={removeChatContextItem}
        onRetry={() => void reloadSelectedHarnessReadiness()}
        onSend={() => void sendChatPrompt()}
        onStop={() => void cancelActiveRun()}
        prompt={chatThread.prompt}
        runError={chatThread.runError}
        running={running}
        tokenLabel={tokenLabel}
        workspaceId={activeWorkspaceId}
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
