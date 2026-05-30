import { useMemo } from "react";
import { ChatBot, Edit } from "@carbon/react/icons";

import { harnessCapabilitiesOf, useWorkspaceStore } from "../../app/workspaceStore";
import { bobRuntimeReadiness, sumChatThreadStats } from "../../app/workspaceModel";
import { formatCoins, formatCompact } from "../../lib/format/numbers";
import { ChatMessageList } from "./ChatMessageList";
import type { MessageRowCallbacks } from "./MessageRow";
import { MessageComposer } from "./MessageComposer";

/**
 * The assistant chat surface. A thin orchestrator: it reads the active
 * workspace's chat thread + harness capabilities from the store, derives
 * availability, and wires the transcript ([ChatMessageList](ChatMessageList.tsx))
 * and the composer ([MessageComposer](MessageComposer.tsx)). All message
 * rendering lives in those modules.
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
  const newChat = useWorkspaceStore((state) => state.newChat);
  const sendChatPrompt = useWorkspaceStore((state) => state.sendChatPrompt);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const setChatPrompt = useWorkspaceStore((state) => state.setChatPrompt);
  const workspaces = useWorkspaceStore((state) => state.workspaces);

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

  return (
    <section className="bob-chat-panel" aria-label="Assistant chat">
      <header className="bob-chat-header">
        <div className="bob-chat-header__title">
          <span className="bob-mark">
            <ChatBot size={16} />
          </span>
          <span>Assistant</span>
        </div>
        <div className="bob-chat-header__actions">
          <span className="bob-chat-header__meta" title="Total token and coin usage this chat">
            {headerMeta}
          </span>
          <button
            type="button"
            className="bob-icon-button bob-chat-header__new"
            aria-label="New chat"
            title="New chat"
            disabled={running || chatThread.messages.length === 0}
            onClick={() => void newChat()}
          >
            <Edit size={16} />
          </button>
        </div>
      </header>

      <ChatMessageList
        callbacks={callbacks}
        messages={chatThread.messages}
        runState={chatThread.runState}
      />

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
