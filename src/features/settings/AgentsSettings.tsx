import { useEffect, useState } from "react";

import { useUiStore } from "../../app/store/uiStore";
import { AgentList } from "./AgentList";
import { AgentDetail } from "./AgentDetail";
import { AddAgentForm } from "./AddAgentForm";
import { CustomInstructionsSection, FileAccessSection } from "./globalAgentSettings";

/** Which view the AI-agents pane shows: the registry list (with the global
 *  sections), one agent's setup/detail, or the add-a-custom-agent form. */
type AgentView = { kind: "list" } | { kind: "detail"; id: string } | { kind: "add" };

/**
 * The "AI agents" settings pane: the registry list plus the global File access +
 * Custom instructions sections, and the per-agent detail / add-agent screens it
 * navigates to. The globals live here (with the list) rather than in any one
 * agent's detail, since they apply to every agent.
 */
export function AgentsSettings() {
  const settingsAgentId = useUiStore((state) => state.settingsAgentId);
  const [view, setView] = useState<AgentView>(() =>
    settingsAgentId ? { kind: "detail", id: settingsAgentId } : { kind: "list" },
  );
  // Consume the deep-link target once (the chat "Set up" action sets it), so
  // leaving and returning to this pane starts at the list, not this agent.
  useEffect(() => {
    if (settingsAgentId) {
      useUiStore.setState({ settingsAgentId: null });
    }
  }, [settingsAgentId]);

  if (view.kind === "detail") {
    return <AgentDetail agentId={view.id} onBack={() => setView({ kind: "list" })} />;
  }
  if (view.kind === "add") {
    return (
      <AddAgentForm
        onBack={() => setView({ kind: "list" })}
        onAdded={(id) => setView({ kind: "detail", id })}
      />
    );
  }
  return (
    <>
      <AgentList
        onOpenAgent={(id) => setView({ kind: "detail", id })}
        onAddAgent={() => setView({ kind: "add" })}
      />
      <FileAccessSection />
      <CustomInstructionsSection />
    </>
  );
}
