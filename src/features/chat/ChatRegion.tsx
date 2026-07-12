import { useEffect, useMemo, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { PaneSplitter } from "../workspace/PaneSplitter";
import { MarkdownLinkContext } from "../../lib/markdown/workspaceLinks";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { useUiStore } from "../../app/store/uiStore";
import { useWorkspaceLinkTargets } from "../../app/useWorkspaceLinkTargets";

/**
 * The chat pane region. Self-subscribes to the chat-pane UI state (pulse nonce)
 * and the link-target set — so it re-renders on chat streaming, not on editor
 * keystrokes. Rendered by AppShell only when `chatOpen`.
 */
export function ChatRegion() {
  const chatPulseSignal = useUiStore((state) => state.chatPulseSignal);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const linkTargets = useWorkspaceLinkTargets();

  // Transient border-pulse: set true whenever a conversation is opened from the
  // sidebar Chat tab (the store bumps `chatPulseSignal`), cleared after the
  // ~650ms keyframe so a subsequent open restarts it. Initial signal (0) is
  // skipped — only an explicit open pulses.
  const [chatPulsing, setChatPulsing] = useState(false);
  useEffect(() => {
    if (chatPulseSignal === 0) {
      return;
    }
    setChatPulsing(true);
    const timer = window.setTimeout(() => setChatPulsing(false), 650);
    return () => window.clearTimeout(timer);
  }, [chatPulseSignal]);

  const chatLinkContext = useMemo(
    () => ({ navigate: (path: string) => void selectFile(path), knownPaths: linkTargets }),
    [selectFile, linkTargets],
  );

  return (
    <aside
      className={["chat-region", chatPulsing ? "chat-region--pulse" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <PaneSplitter pane="chat" />
      <MarkdownLinkContext.Provider value={chatLinkContext}>
        <ChatPanel />
      </MarkdownLinkContext.Provider>
    </aside>
  );
}
