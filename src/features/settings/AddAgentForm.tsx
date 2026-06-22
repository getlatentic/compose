import { ArrowLeft } from "@carbon/react/icons";

/**
 * Register a custom agent — an OpenAI-compatible endpoint (base URL + key +
 * model) or an ACP agent command. Placeholder pending the custom-agent backend
 * (registry persistence + IPC); {@link AgentList} routes its "Add an agent…"
 * action here.
 */
export function AddAgentForm(props: { onBack: () => void; onAdded: (id: string) => void }) {
  return (
    <div className="agent-detail">
      <button type="button" className="agent-detail__back" onClick={props.onBack}>
        <ArrowLeft aria-hidden />
        Agents
      </button>
      <div className="agent-detail__head">
        <h3>Add an agent</h3>
      </div>
      <p className="settings-helper">
        Connect a custom OpenAI-compatible endpoint or an ACP agent command — coming next.
      </p>
    </div>
  );
}
