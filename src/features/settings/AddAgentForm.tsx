import { FormEvent, useState } from "react";
import {
  Button,
  InlineNotification,
  PasswordInput,
  RadioButton,
  RadioButtonGroup,
  TextInput,
} from "@carbon/react";
import { ArrowLeft } from "@carbon/react/icons";

import { useHarnessStore } from "../../app/store/harnessStore";
import {
  harnessAddCustom,
  harnessSetCredential,
  type CustomAgentInput,
  type CustomAgentKind,
} from "../../lib/ipc/harnessClient";

type Kind = "openAiCompatible" | "acp";

/**
 * Register a custom agent — an OpenAI-compatible endpoint (base URL + optional
 * key + model) or an ACP agent command. It joins the registry and the chat
 * footer. The agent is added FIRST, then its key saved (`harness_set_credential`
 * resolves the agent from the registry), then the catalog reloads and we open
 * the new agent's detail.
 */
export function AddAgentForm({
  onBack,
  onAdded,
}: {
  onBack: () => void;
  onAdded: (id: string) => void;
}) {
  const loadHarnessCatalog = useHarnessStore((state) => state.loadHarnessCatalog);
  const [kind, setKind] = useState<Kind>("openAiCompatible");
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const kindPayload: CustomAgentKind =
        kind === "acp"
          ? {
              type: "acp",
              command: command.trim(),
              args: args.trim() ? args.trim().split(/\s+/) : [],
            }
          : {
              type: "openAiCompatible",
              baseUrl: baseUrl.trim(),
              defaultModel: defaultModel.trim() || null,
              requiresKey: apiKey.trim().length > 0,
            };
      const input: CustomAgentInput = { displayName: displayName.trim(), kind: kindPayload };
      const record = await harnessAddCustom(input);
      if (kindPayload.type === "openAiCompatible" && apiKey.trim()) {
        await harnessSetCredential(record.id, apiKey.trim());
      }
      await loadHarnessCatalog();
      onAdded(record.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the agent");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agent-detail">
      <div className="settings-section">
        <button type="button" className="agent-detail__back" onClick={onBack}>
          <ArrowLeft aria-hidden />
          Agents
        </button>
        <div className="agent-detail__head">
          <h3>Add an agent</h3>
        </div>
        <p className="settings-helper">
          Connect a custom AI endpoint or agent command. It joins your agent list and the chat
          footer.
        </p>
      </div>

      <form className="settings-section settings-form" onSubmit={handleSubmit}>
        <RadioButtonGroup
          name="agent-kind"
          legendText="Type"
          orientation="vertical"
          valueSelected={kind}
          onChange={(value) => setKind(value as Kind)}
        >
          <RadioButton
            id="kind-openai"
            labelText="OpenAI-compatible endpoint (base URL + key)"
            value="openAiCompatible"
          />
          <RadioButton id="kind-acp" labelText="Agent command (ACP)" value="acp" />
        </RadioButtonGroup>

        <TextInput
          id="agent-name"
          labelText="Name"
          placeholder="e.g. My Gateway"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />

        {kind === "openAiCompatible" ? (
          <>
            <TextInput
              id="agent-base-url"
              labelText="Base URL"
              placeholder="https://…"
              helperText="Chat hits {base}/v1/chat/completions."
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
            <TextInput
              id="agent-default-model"
              labelText="Default model (optional)"
              placeholder="e.g. gpt-4o"
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
            />
            <PasswordInput
              id="agent-api-key"
              labelText="API key (optional)"
              helperText="Stored in your OS keychain. Leave blank for a no-auth local server."
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
            />
          </>
        ) : (
          <>
            <TextInput
              id="agent-command"
              labelText="Command"
              placeholder="e.g. gemini"
              helperText="The program that launches the ACP server."
              value={command}
              onChange={(event) => setCommand(event.target.value)}
            />
            <TextInput
              id="agent-args"
              labelText="Arguments (optional, space-separated)"
              placeholder="e.g. --experimental-acp"
              value={args}
              onChange={(event) => setArgs(event.target.value)}
            />
          </>
        )}

        {error ? (
          <InlineNotification
            hideCloseButton
            kind="error"
            lowContrast
            subtitle={error}
            title="Couldn't add agent"
          />
        ) : null}
        <div className="settings-actions">
          <Button size="sm" type="submit" disabled={saving}>
            {saving ? "Adding…" : "Add agent"}
          </Button>
          <Button size="sm" kind="ghost" type="button" onClick={onBack}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
