import { FormEvent, useEffect, useState } from "react";
import {
  Accordion,
  AccordionItem,
  Button,
  InlineNotification,
  PasswordInput,
  Select,
  SelectItem,
} from "@carbon/react";

import {
  harnessCapabilitiesOf,
  supportsPermissionMode,
  type HarnessRunOptions,
} from "../../app/workspaceStore";
import { useHarnessStore } from "../../app/store/harnessStore";
import {
  harnessCredentialStatus,
  harnessSetCredential,
  type HarnessInstallEvent,
  type HarnessRuntimeVerification,
} from "../../lib/ipc/harnessClient";
import { ModelPicker } from "./ModelPicker";
import { OllamaModelManager } from "./OllamaModelManager";

/**
 * The per-agent configuration controls shared by the Settings detail screen.
 * These are capability-driven and id-agnostic: each renders only the fields the
 * agent's declared capabilities support, so a new agent needs no edits here.
 */

/** Reasoning-effort levels (Codex's `model_reasoning_effort`). Neutral
 *  presets — whether an agent honors them is decided by its `supportsEffort`
 *  capability, not this list. */
const EFFORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Default" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/** Preset turn caps for Claude (`--max-turns`). */
const MAX_TURNS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Default (no cap)" },
  { value: "3", label: "3 turns" },
  { value: "5", label: "5 turns" },
  { value: "10", label: "10 turns" },
  { value: "20", label: "20 turns" },
];

/** Setup for an agent that manages its own login (Claude/Codex) or needs a key
 *  (OpenRouter): a key form where one is required, plus the model + run options.
 *  Which controls appear is driven by the agent's declared capabilities. */
export function ExternalHarnessSetup({ harnessId }: { harnessId: string }) {
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const info = harnessCatalog.find((entry) => entry.id === harnessId);
  const caps = harnessCapabilitiesOf(harnessCatalog, harnessId);
  const name = info?.displayName ?? harnessId;

  return (
    <>
      {caps.credentialRequired ? <HarnessCredentialForm harnessId={harnessId} name={name} /> : null}
      <ExternalHarnessOptions harnessId={harnessId} />
    </>
  );
}

/** The per-agent run-tuning controls (permission mode, max turns, effort) in a
 *  collapsed "Advanced" accordion. The model itself is picked in the main detail
 *  via {@link ModelPicker} — only these power-user knobs are tucked away. Driven
 *  by the agent's declared capabilities, so a new agent needs zero edits here. */
export function ExternalHarnessOptions({ harnessId }: { harnessId: string }) {
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const options =
    useHarnessStore((state) => state.harnessOptions[harnessId]) ?? ({} as HarnessRunOptions);
  const setHarnessOptions = useHarnessStore((state) => state.setHarnessOptions);
  const loadHarnessModels = useHarnessStore((state) => state.loadHarnessModels);
  const modelManagement = useHarnessStore((state) => state.harnessModelManagement[harnessId]);
  const loadHarnessModelManagement = useHarnessStore(
    (state) => state.loadHarnessModelManagement,
  );
  const caps = harnessCapabilitiesOf(harnessCatalog, harnessId);

  // Discover models live for agents without a curated compile-time list
  // (Ollama / OpenCode / OpenRouter / Codex), so the picker has options. claude
  // ships `caps.models`, so skip the probe for it.
  useEffect(() => {
    if (caps.models.length === 0) {
      void loadHarnessModels(harnessId);
    }
  }, [harnessId, caps.models.length, loadHarnessModels]);

  // Probe whether this agent manages its own local models (Ollama). Drives the
  // model-management section below; null for every other agent.
  useEffect(() => {
    void loadHarnessModelManagement(harnessId);
  }, [harnessId, loadHarnessModelManagement]);

  // Only build the accordion when the agent actually has a knob to show — most
  // agents have none, and an empty "Advanced" twisty is just noise.
  const hasAdvanced =
    supportsPermissionMode(harnessId) || caps.supportsMaxTurns || caps.supportsEffort;

  return (
    <>
      {/* The model picker leads (most-touched setting); Ollama's download/manage
          section follows; the power-user knobs hide in "Advanced". */}
      <ModelPicker harnessId={harnessId} />
      {modelManagement ? <OllamaModelManager harnessId={harnessId} /> : null}
      {hasAdvanced ? (
      <div className="settings-section">
        <Accordion>
          <AccordionItem title="Advanced">
            <div style={{ display: "grid", gap: "1rem", maxWidth: "22rem" }}>
          {supportsPermissionMode(harnessId) ? (
            <Select
              id={`${harnessId}-permission-mode`}
              labelText="How much it can do on its own"
              helperText="Default runs autonomously in your folder; every change is undoable from a file's “Previous versions”."
              value={options.permissionMode ?? ""}
              onChange={(event) =>
                setHarnessOptions(harnessId, { permissionMode: event.target.value || undefined })
              }
            >
              {/* Only headless-safe modes: "" (Compose's bypass default) and auto
                  both run without an unanswerable prompt. acceptEdits/default
                  would deadlock a headless run on the first Bash call. */}
              <SelectItem value="" text="Autonomous — no prompts (recommended)" />
              <SelectItem value="auto" text="Guarded — vet risky actions (Sonnet/Opus 4.6+)" />
            </Select>
          ) : null}

          {caps.supportsMaxTurns ? (
            <Select
              id={`${harnessId}-max-turns`}
              labelText="Max turns"
              helperText="Stop the agent after this many turns."
              value={options.maxTurns != null ? String(options.maxTurns) : ""}
              onChange={(event) =>
                setHarnessOptions(harnessId, {
                  maxTurns: event.target.value ? Number(event.target.value) : undefined,
                })
              }
            >
              {MAX_TURNS_OPTIONS.map((turns) => (
                <SelectItem key={turns.value} value={turns.value} text={turns.label} />
              ))}
            </Select>
          ) : null}

          {caps.supportsEffort ? (
            <Select
              id={`${harnessId}-effort`}
              labelText="Reasoning effort"
              helperText="How hard the model thinks before acting."
              value={options.effort ?? ""}
              onChange={(event) =>
                setHarnessOptions(harnessId, {
                  effort: (event.target.value || undefined) as HarnessRunOptions["effort"],
                })
              }
            >
              {EFFORT_OPTIONS.map((effort) => (
                <SelectItem key={effort.value} value={effort.value} text={effort.label} />
              ))}
            </Select>
          ) : null}
            </div>
          </AccordionItem>
        </Accordion>
      </div>
      ) : null}
    </>
  );
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

export interface ManagedHarnessSetupProps {
  name: string;
  apiKey: string;
  setApiKey: (value: string) => void;
  authConfigured: boolean;
  needsInstall: boolean;
  installing: boolean;
  installLog: InstallLogEntry[];
  installResult: Extract<HarnessInstallEvent, { kind: "done" }> | null;
  logRef: React.RefObject<HTMLPreElement>;
  errorMessage: string | null;
  saveSuccess: boolean;
  saving: boolean;
  checkingRuntime: boolean;
  runtimeCheck: HarnessRuntimeVerification | null;
  onInstall: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRuntimeCheck: () => void;
}

/** Setup for a Compose-managed agent (bob): Compose both installs it and stores
 *  its key, so this is the full install + key + smoke-test panel. State is owned
 *  by the caller (the detail screen) and threaded in. */
export function ManagedHarnessSetup(props: ManagedHarnessSetupProps) {
  const {
    name,
    apiKey,
    setApiKey,
    authConfigured,
    needsInstall,
    installing,
    installLog,
    installResult,
    logRef,
    errorMessage,
    saveSuccess,
    saving,
    checkingRuntime,
    runtimeCheck,
    onInstall,
    onSubmit,
    onRuntimeCheck,
  } = props;
  return (
    <>
      {/* ----- Install / re-install ------------------------- */}
      <div className="settings-section">
        <h3>{name} CLI</h3>
        <p className="settings-helper">
          {needsInstall
            ? `${name} runs as a local CLI. Click below to install it via nvm + npm — no sudo needed.`
            : `${name} is installed. Reinstall to update to the latest version.`}
        </p>
        <div className="settings-actions">
          <Button
            disabled={installing}
            size="sm"
            kind={needsInstall ? "primary" : "secondary"}
            onClick={onInstall}
          >
            {installing ? "Installing…" : needsInstall ? `Install ${name}` : "Reinstall / update"}
          </Button>
        </div>
        {installLog.length > 0 ? (
          <pre
            ref={logRef}
            className="settings-install-log"
            aria-label={`${name} install progress`}
            aria-live="polite"
          >
            {installLog.map((entry, i) => (
              <div
                key={i}
                className={`settings-install-log__line settings-install-log__line--${entry.kind}`}
              >
                {entry.kind === "step" ? "› " : entry.kind === "stderr" ? "! " : "  "}
                {entry.text}
              </div>
            ))}
          </pre>
        ) : null}
        {installResult ? (
          <InlineNotification
            hideCloseButton
            kind={installResult.ok ? "success" : "error"}
            lowContrast
            title={installResult.ok ? `${name} installed` : "Install failed"}
            subtitle={
              installResult.ok
                ? `${name} CLI is ready. Add your API key below to start chatting.`
                : `Exited with code ${installResult.exitCode ?? "?"}. Check the log above for details.`
            }
          />
        ) : null}
      </div>

      {/* ----- API key ------------------------------------- */}
      <form onSubmit={onSubmit} className="settings-section settings-form">
        <h3>{name} API key</h3>
        <PasswordInput
          id="settings-bob-key"
          labelText={`${name} API key`}
          helperText={
            authConfigured
              ? "Paste a new key to replace the saved one."
              : `Paste your ${name} API key. Stored locally in your OS keychain.`
          }
          value={apiKey}
          onChange={(event) => setApiKey(event.currentTarget.value)}
          placeholder={authConfigured ? "Replace saved key" : `Paste ${name} API key`}
        />
        {errorMessage ? (
          <InlineNotification
            hideCloseButton
            kind="error"
            lowContrast
            subtitle={errorMessage}
            title="Setup error"
          />
        ) : saveSuccess ? (
          <InlineNotification
            hideCloseButton
            kind="success"
            lowContrast
            subtitle="Stored in your macOS Keychain. Bob is ready to use."
            title="API key saved"
          />
        ) : null}
        <div className="settings-actions">
          <Button disabled={saving} size="sm" type="submit">
            {saving ? "Saving" : "Save key"}
          </Button>
          <Button
            disabled={checkingRuntime}
            kind="secondary"
            onClick={onRuntimeCheck}
            size="sm"
            type="button"
          >
            {checkingRuntime ? "Testing" : `Test ${name}`}
          </Button>
        </div>
        {runtimeCheck ? <RuntimeCheckResult result={runtimeCheck} name={name} /> : null}
      </form>
    </>
  );
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
