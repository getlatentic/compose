import { FormEvent, useEffect, useState } from "react";
import { Button, InlineNotification, PasswordInput } from "@carbon/react";
import { CheckmarkFilled } from "@carbon/react/icons";

import { harnessCapabilitiesOf } from "../../app/workspaceStore";
import { useHarnessStore } from "../../app/store/harnessStore";
import {
  harnessCredentialStatus,
  harnessSetCredential,
  type HarnessInstallEvent,
  type HarnessRuntimeVerification,
} from "../../lib/ipc/harnessClient";
import { ModelPicker } from "./ModelPicker";
import { errorMessage } from "../../app/store/internals";

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
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void harnessCredentialStatus(harnessId)
      .then((status) => {
        if (active) {
          setConfigured(status.configured);
          setHint(status.hint ?? null);
        }
      })
      .catch(() => {
        if (active) setConfigured(false);
      });
    return () => {
      active = false;
    };
  }, [harnessId]);

  // Clearing has to be its own action. It used to be reachable by submitting an
  // empty field — a primary button, one careless click, and the key was gone
  // with the same wording as storing one.
  async function handleRemove() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await harnessSetCredential(harnessId, "");
      setApiKey("");
      const cleared = await harnessCredentialStatus(harnessId);
      setConfigured(cleared.configured);
      setHint(cleared.hint ?? null);
    } catch (err) {
      setError(errorMessage(err, `Could not remove the ${name} API key`));
    } finally {
      setSaving(false);
    }
  }

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
      setHint(status.hint ?? null);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(errorMessage(err, `Could not save the ${name} API key`));
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
            ? "Paste a new key to replace the saved one."
            : `Paste your ${name} API key. Stored locally in your OS keychain.`
        }
        value={apiKey}
        onChange={(event) => setApiKey(event.currentTarget.value)}
        placeholder={configured ? "Replace saved key" : `Paste ${name} API key`}
      />
      {/* The resting state has to SAY it is configured. The success banner
          clears itself after four seconds, and what remained was helper text
          phrased as an instruction — so a saved key looked like an empty field
          nobody had filled in yet. */}
      {configured && !error && !saved ? (
        <p className="settings-helper settings-helper--ok">
          <CheckmarkFilled size={16} aria-hidden />{" "}
          {hint ? (
            <>
              Saved key <code>{hint}</code> — {name} is ready to use.
            </>
          ) : (
            <>A key is saved — {name} is ready to use.</>
          )}
        </p>
      ) : null}
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
        {/* Nothing typed is nothing to save. Enabled, this submitted an empty
            value, which CLEARS the stored key. */}
        <Button disabled={saving || apiKey.trim() === ""} size="sm" type="submit">
          {saving ? "Saving" : configured ? "Replace key" : "Save key"}
        </Button>
        {configured ? (
          <Button disabled={saving} kind="ghost" size="sm" type="button" onClick={handleRemove}>
            Remove key
          </Button>
        ) : null}
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
