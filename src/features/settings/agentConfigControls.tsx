import { FormEvent, useEffect, useState } from "react";
import { Button, InlineNotification, PasswordInput } from "@carbon/react";

import { harnessCapabilitiesOf } from "../../app/workspaceStore";
import { useHarnessStore } from "../../app/store/harnessStore";
import {
  harnessCredentialStatus,
  harnessSetCredential,
  type HarnessInstallEvent,
  type HarnessRuntimeVerification,
} from "../../lib/ipc/harnessClient";
import { ModelPicker } from "./ModelPicker";

/**
 * The per-agent configuration controls shared by the Settings detail screen.
 * These are capability-driven and id-agnostic: each renders only the fields the
 * agent's declared capabilities support, so a new agent needs no edits here.
 */

/** The "Default model" section: discovers an agent's models live where it has no
 *  curated compile-time list (Ollama / OpenCode / OpenRouter / Codex) so the
 *  picker has options, then renders the picker. Claude ships `caps.models`, so
 *  the probe is skipped for it. The picker returns nothing for an agent with no
 *  models and no custom ids, so this stays out of the way for those. */
export function ModelSection({ harnessId }: { harnessId: string }) {
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const loadHarnessModels = useHarnessStore((state) => state.loadHarnessModels);
  const caps = harnessCapabilitiesOf(harnessCatalog, harnessId);

  useEffect(() => {
    if (caps.models.length === 0) {
      void loadHarnessModels(harnessId);
    }
  }, [harnessId, caps.models.length, loadHarnessModels]);

  return <ModelPicker harnessId={harnessId} />;
}

/** Generic API-key form for a key-only agent (OpenRouter). Writes through the
 *  generic `harness_set_credential` keychain path. The agent's `readiness()`
 *  reflects the key once saved (Compose exports it into the env), so there's no
 *  separate "test" step. */
export function HarnessCredentialForm({ harnessId, name }: { harnessId: string; name: string }) {
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void harnessCredentialStatus(harnessId)
      .then((status) => {
        if (active) setConfigured(status.configured);
      })
      .catch(() => {
        if (active) setConfigured(false);
      });
    return () => {
      active = false;
    };
  }, [harnessId]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await harnessSetCredential(harnessId, apiKey);
      setApiKey("");
      const status = await harnessCredentialStatus(harnessId);
      setConfigured(status.configured);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not save the ${name} API key`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="settings-section settings-form">
      <h3>{name} API key</h3>
      <PasswordInput
        id={`${harnessId}-credential`}
        labelText={`${name} API key`}
        helperText={
          configured
            ? "A key is saved. Paste a new one to replace it."
            : `Paste your ${name} API key. Stored locally in your OS keychain.`
        }
        value={apiKey}
        onChange={(event) => setApiKey(event.currentTarget.value)}
        placeholder={configured ? "Replace saved key" : `Paste ${name} API key`}
      />
      {error ? (
        <InlineNotification
          hideCloseButton
          kind="error"
          lowContrast
          subtitle={error}
          title="Setup error"
        />
      ) : saved ? (
        <InlineNotification
          hideCloseButton
          kind="success"
          lowContrast
          subtitle={`Stored in your keychain. ${name} is ready to use.`}
          title="API key saved"
        />
      ) : null}
      <div className="settings-actions">
        <Button disabled={saving} size="sm" type="submit">
          {saving ? "Saving" : "Save key"}
        </Button>
      </div>
    </form>
  );
}

export interface InstallLogEntry {
  kind: HarnessInstallEvent["kind"];
  text: string;
}

export function RuntimeCheckResult({
  result,
  name,
}: {
  result: HarnessRuntimeVerification;
  name: string;
}) {
  const kind = result.authenticated ? "success" : "error";
  const title = result.authenticated ? `${name} verified` : `${name} not ready`;
  const details = [
    result.version ? `Version: ${result.version}` : null,
    result.errorMessage,
    result.outputPreview ? `Reply: ${result.outputPreview}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="settings-runtime">
      <InlineNotification hideCloseButton kind={kind} lowContrast subtitle={details} title={title} />
    </div>
  );
}
