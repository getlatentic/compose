import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Button,
  InlineNotification,
  PasswordInput,
  Select,
  SelectItem,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  TextInput,
  Toggle,
} from "@carbon/react";
import {
  harnessCapabilitiesOf,
  supportsPermissionMode,
  type HarnessRunOptions,
} from "../../app/workspaceStore";
import { useUiStore } from "../../app/store/uiStore";
import { useHarnessStore } from "../../app/store/harnessStore";
import {
  harnessCredentialStatus,
  harnessInstall,
  harnessReadiness,
  harnessSetCredential,
  verifyHarnessRuntime,
  type HarnessInstallEvent,
  type HarnessReadiness,
  type HarnessRuntimeVerification,
} from "../../lib/ipc/harnessClient";
import { revealErrorLog } from "../../lib/diagnostics/errorReporter";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { HarnessPicker } from "./HarnessPicker";

/** bob's `readiness().details` payload (a JSON object on the wire). Read for
 * the Node.js diagnostics the setup UI surfaces ("Runtime: Node …"). */
interface BobReadinessDetails {
  node?: {
    version?: string | null;
    satisfies_min?: boolean;
    min_version?: string;
    installed?: boolean;
  };
}

/** Narrow a harness readiness's opaque `details` to bob's node diagnostics. */
function bobNodeVersion(readiness: HarnessReadiness | null): string | null {
  const details = readiness?.details as BobReadinessDetails | null | undefined;
  return details?.node?.version ?? null;
}

/**
 * Settings content — the canonical surface for first-time harness setup and
 * ongoing maintenance. Rendered either inside a workspace tab (the pane
 * host) or, on the dashboard where there is no tab strip, inside the
 * modal wrapper [SettingsDialog](./SettingsDialog.tsx). It owns no chrome
 * (no backdrop / title bar) so it composes into either host.
 */
export function SettingsPanel() {
  const selectedHarnessReadiness = useHarnessStore((state) => state.selectedHarnessReadiness);
  const selectedHarnessId = useHarnessStore((state) => state.selectedHarnessId);
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const setSelectedHarnessReadiness = useHarnessStore((state) => state.setSelectedHarnessReadiness);
  const soundOnComplete = useUiStore((state) => state.soundOnComplete);
  const setSoundOnComplete = useUiStore((state) => state.setSoundOnComplete);
  const [apiKey, setApiKey] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [runtimeCheck, setRuntimeCheck] = useState<HarnessRuntimeVerification | null>(null);
  const [checkingRuntime, setCheckingRuntime] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<InstallLogEntry[]>([]);
  const [installResult, setInstallResult] = useState<
    Extract<HarnessInstallEvent, { kind: "done" }> | null
  >(null);
  const logRef = useRef<HTMLPreElement>(null);

  // Auto-scroll the install log to the bottom as new lines arrive.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [installLog.length]);

  // The managed harness's "key saved" state from credential-status: probed on
  // open and whenever the selection changes, refreshed after a save.
  const [managedKeyConfigured, setManagedKeyConfigured] = useState(false);
  useEffect(() => {
    let active = true;
    void harnessCredentialStatus(selectedHarnessId)
      .then((status) => {
        if (active) setManagedKeyConfigured(status.configured);
      })
      .catch(() => {
        if (active) setManagedKeyConfigured(false);
      });
    return () => {
      active = false;
    };
  }, [selectedHarnessId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSaveSuccess(false);
    setSaving(true);
    try {
      await harnessSetCredential(selectedHarnessId, apiKey);
      setSelectedHarnessReadiness(await harnessReadiness(selectedHarnessId));
      setManagedKeyConfigured((await harnessCredentialStatus(selectedHarnessId)).configured);
      setApiKey("");
      setRuntimeCheck(null);
      setSaveSuccess(true);
      window.setTimeout(() => setSaveSuccess(false), 4000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Bob API key could not be saved");
    } finally {
      setSaving(false);
    }
  }

  async function handleRuntimeCheck() {
    setCheckingRuntime(true);
    setErrorMessage(null);
    try {
      const result = await verifyHarnessRuntime(selectedHarnessId);
      setRuntimeCheck(result);
      setSelectedHarnessReadiness(await harnessReadiness(selectedHarnessId));
    } catch (error) {
      setRuntimeCheck(null);
      setErrorMessage(error instanceof Error ? error.message : "Bob runtime check failed");
    } finally {
      setCheckingRuntime(false);
    }
  }

  async function handleInstall() {
    setInstalling(true);
    setInstallLog([]);
    setInstallResult(null);
    setErrorMessage(null);
    try {
      for await (const event of harnessInstall(selectedHarnessId)) {
        setInstallLog((prev) => [
          ...prev,
          { kind: event.kind, text: "text" in event ? event.text : "" },
        ]);
        if (event.kind === "done") {
          setInstallResult(event);
          setSelectedHarnessReadiness(await harnessReadiness(selectedHarnessId));
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Install failed");
    } finally {
      setInstalling(false);
    }
  }

  const needsInstall = !selectedHarnessReadiness?.installed;

  // "Managed setup" = Compose both installs the harness AND stores its key (bob
  // today): the full install + key + smoke-test panel. Derived from the
  // selected harness's catalog capabilities, not its id; every other harness
  // uses the generic setup (a key form when it needs one).
  const selectedInfo = harnessCatalog.find((entry) => entry.id === selectedHarnessId);
  const usesManagedSetup = Boolean(
    selectedInfo?.requiresInstall &&
      harnessCapabilitiesOf(harnessCatalog, selectedHarnessId).credentialRequired,
  );

  return (
    <Tabs>
      <TabList aria-label="Settings sections" contained>
        <Tab>AI assistant</Tab>
        <Tab>About</Tab>
      </TabList>
      <TabPanels>
        {/* ----- AI assistant tab ------------------------- */}
        <TabPanel>
          <HarnessPicker />

          {/* Provider detail. Always rendered in a stable region so
              switching providers swaps the content in place instead of
              collapsing the layout (the old conditional caused a jump). */}
          <div className="settings-provider-detail">
            {usesManagedSetup ? (
              <ManagedHarnessSetup
                apiKey={apiKey}
                setApiKey={setApiKey}
                authConfigured={managedKeyConfigured}
                needsInstall={needsInstall}
                installing={installing}
                installLog={installLog}
                installResult={installResult}
                logRef={logRef}
                errorMessage={errorMessage}
                saveSuccess={saveSuccess}
                saving={saving}
                checkingRuntime={checkingRuntime}
                runtimeCheck={runtimeCheck}
                onInstall={() => void handleInstall()}
                onSubmit={handleSubmit}
                onRuntimeCheck={() => void handleRuntimeCheck()}
              />
            ) : (
              <ExternalHarnessSetup harnessId={selectedHarnessId} />
            )}
          </div>

          <div className="settings-section">
            <h3>Preferences</h3>
            <Toggle
              id="sound-on-complete"
              size="sm"
              labelText="Sound when a run finishes"
              labelA="Off"
              labelB="On"
              toggled={soundOnComplete}
              onToggle={(checked) => setSoundOnComplete(checked)}
            />
            <p className="settings-helper">
              Play a subtle chime when the assistant finishes a run.
            </p>
          </div>
        </TabPanel>

        {/* ----- About tab ------------------------------- */}
        <TabPanel>
          <div className="settings-section">
            <h3>About Compose</h3>
            <p className="settings-helper">Compose · version 0.1.0</p>
            <p className="settings-helper">
              A local-first AI writing workspace — your notes stay on your computer. AI for
              everyone.
            </p>
            {bobNodeVersion(selectedHarnessReadiness) ? (
              <p className="settings-helper">Runtime: Node.js {bobNodeVersion(selectedHarnessReadiness)}</p>
            ) : null}
          </div>
          {isTauriRuntime() ? (
            <div className="settings-section">
              <h3>Report a problem</h3>
              <p className="settings-helper">
                Compose keeps a local error log on your computer — it's never sent anywhere. If
                something goes wrong, open it and attach it to your report.
              </p>
              <Button size="sm" kind="tertiary" onClick={() => void revealErrorLog()}>
                Open error log
              </Button>
            </div>
          ) : null}
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}

/** Reasoning-effort levels (Codex's `model_reasoning_effort`). Neutral
 *  presets — whether a harness honors them is decided by its
 *  `supportsEffort` capability, not this list. */
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

/** Detail for an external CLI harness (Claude/Codex). They manage their
 *  own login, so there's nothing to *connect* here — but the user can
 *  pick a model and run options (persisted per harness, forwarded on
 *  every run). Which controls appear is driven entirely by the harness's
 *  declared capabilities, not its id: a curated model list → dropdown, a
 *  free-text model → text field, plus effort / max-turns where supported.
 *  A new harness needs zero edits here. Each control left on "Default"
 *  omits the flag so the CLI uses its own default. */
function ExternalHarnessSetup({ harnessId }: { harnessId: string }) {
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const info = harnessCatalog.find((entry) => entry.id === harnessId);
  const caps = harnessCapabilitiesOf(harnessCatalog, harnessId);
  const name = info?.displayName ?? harnessId;

  return (
    <>
      {/* Key-only cloud providers (OpenRouter) need an API key Compose stores;
          login-managed CLIs and local servers (Ollama/OpenCode) don't. */}
      {caps.credentialRequired ? <HarnessCredentialForm harnessId={harnessId} name={name} /> : null}
      <ExternalHarnessOptions harnessId={harnessId} name={name} />
    </>
  );
}

/** The per-harness model + run-option controls (model, permission mode, max
 *  turns, effort, edit-review). Driven by the harness's declared capabilities —
 *  a new harness needs zero edits here. */
function ExternalHarnessOptions({ harnessId, name }: { harnessId: string; name: string }) {
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const options =
    useHarnessStore((state) => state.harnessOptions[harnessId]) ?? ({} as HarnessRunOptions);
  const setHarnessOptions = useHarnessStore((state) => state.setHarnessOptions);
  const harnessModels = useHarnessStore((state) => state.harnessModels);
  const loadHarnessModels = useHarnessStore((state) => state.loadHarnessModels);
  const caps = harnessCapabilitiesOf(harnessCatalog, harnessId);

  // Discover models live for harnesses without a curated compile-time list
  // (Ollama / OpenCode / OpenRouter / Codex). claude ships `caps.models`, so skip
  // the probe for it. Failures resolve to [] → the free-text field below.
  useEffect(() => {
    if (caps.models.length === 0) {
      void loadHarnessModels(harnessId);
    }
  }, [harnessId, caps.models.length, loadHarnessModels]);
  const dynamicModels = harnessModels[harnessId] ?? [];
  const currentModel = options.model ?? "";

  return (
    <div className="settings-section">
      <h3>{name} setup</h3>
      <p className="settings-helper">
        {caps.credentialRequired
          ? `Add your ${name} API key above. Choose a model and run options below; leave a field on "Default" to use ${name}'s own default.`
          : `${name} uses your existing ${name} login — there's nothing to connect here. If it isn't installed yet, use the Install button on its card above. Choose a model and run options below; leave a field on "Default" to use ${name}'s own default.`}
      </p>

      <div style={{ display: "grid", gap: "1rem", maxWidth: "22rem", marginBlockStart: "0.75rem" }}>
        {/* Edit-safety control. Off by default: {name} works in your real
            folder (so its paths, skills, and memory line up), and a pre-run
            baseline makes every edit undoable. On is strict pre-approval —
            {name} works on a throwaway copy and you approve the diff first,
            at the cost of isolating it from your real folder. */}
        <Toggle
          id={`${harnessId}-review-edits`}
          size="sm"
          labelText="Review changes before applying"
          labelA="Off — work in my folder (undo anytime)"
          labelB="On — work on a copy, approve first"
          toggled={options.reviewEdits ?? false}
          onToggle={(checked) => setHarnessOptions(harnessId, { reviewEdits: checked })}
        />
        <p className="settings-helper" style={{ marginBlockStart: "-0.5rem" }}>
          Off (default): changes apply to your files as {name} works, and you can undo any of them
          from a file's “Previous versions”. On: {name} works on a copy and you approve each change
          before it lands — safer to preview, but {name} can't see your real folder or its tools.
        </p>

        {/* Model picker, in priority: a live-discovered list (Ollama/OpenCode/
            OpenRouter/Codex) → dropdown; else free-text where custom ids are
            allowed; else a curated dropdown (claude). A discovered list that came
            back empty (offline, Ollama down) falls through to free-text so the
            field is never a dead end. The current value is always selectable even
            if it predates the discovered list. */}
        {dynamicModels.length > 0 ? (
          <Select
            id={`${harnessId}-model`}
            labelText="Model"
            value={currentModel}
            onChange={(event) =>
              setHarnessOptions(harnessId, { model: event.target.value || undefined })
            }
          >
            <SelectItem value="" text="Default (the model decides)" />
            {dynamicModels.map((model) => (
              <SelectItem key={model.value} value={model.value} text={model.label} />
            ))}
            {currentModel && !dynamicModels.some((model) => model.value === currentModel) ? (
              <SelectItem value={currentModel} text={currentModel} />
            ) : null}
          </Select>
        ) : caps.allowsCustomModel ? (
          <TextInput
            id={`${harnessId}-model`}
            labelText="Model"
            placeholder="Default (the CLI decides)"
            value={currentModel}
            onChange={(event) =>
              setHarnessOptions(harnessId, { model: event.target.value || undefined })
            }
          />
        ) : caps.models.length > 0 ? (
          <Select
            id={`${harnessId}-model`}
            labelText="Model"
            value={currentModel}
            onChange={(event) =>
              setHarnessOptions(harnessId, { model: event.target.value || undefined })
            }
          >
            <SelectItem value="" text="Default (the CLI decides)" />
            {caps.models.map((model) => (
              <SelectItem key={model.value} value={model.value} text={model.label} />
            ))}
          </Select>
        ) : null}

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
    </div>
  );
}

/** Generic API-key form for a key-only harness (OpenRouter). Mirrors bob's key
 *  form but writes through the generic `harness_set_credential` keychain path
 *  rather than bob-rs. The harness's `readiness()` reflects the key once saved
 *  (Compose exports it into the env), so there's no separate "test" step. */
function HarnessCredentialForm({ harnessId, name }: { harnessId: string; name: string }) {
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

interface ManagedHarnessSetupProps {
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

function ManagedHarnessSetup(props: ManagedHarnessSetupProps) {
  const {
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
        <h3>Bob CLI</h3>
        <p className="settings-helper">
          {needsInstall
            ? "Bob runs as a local CLI. Click below to install it via nvm + npm — no sudo needed."
            : "Bob is installed. Reinstall to update to the latest version."}
        </p>
        <div className="settings-actions">
          <Button
            disabled={installing}
            size="sm"
            kind={needsInstall ? "primary" : "secondary"}
            onClick={onInstall}
          >
            {installing ? "Installing…" : needsInstall ? "Install Bob" : "Reinstall / update"}
          </Button>
        </div>
        {installLog.length > 0 ? (
          <pre
            ref={logRef}
            className="settings-install-log"
            aria-label="Bob install progress"
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
            title={installResult.ok ? "Bob installed" : "Install failed"}
            subtitle={
              installResult.ok
                ? "Bob CLI is ready. Add your API key below to start chatting."
                : `Exited with code ${installResult.exitCode ?? "?"}. Check the log above for details.`
            }
          />
        ) : null}
      </div>

      {/* ----- API key ------------------------------------- */}
      <form onSubmit={onSubmit} className="settings-section settings-form">
        <h3>Bob API key</h3>
        <PasswordInput
          id="settings-bob-key"
          labelText="Bob API key"
          helperText={
            authConfigured
              ? "Paste a new key to replace the saved one."
              : "Paste your Bob API key. Stored locally in your OS keychain."
          }
          value={apiKey}
          onChange={(event) => setApiKey(event.currentTarget.value)}
          placeholder={authConfigured ? "Replace saved key" : "Paste Bob API key"}
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
            {checkingRuntime ? "Testing" : "Test Bob"}
          </Button>
        </div>
        {runtimeCheck ? <RuntimeCheckResult result={runtimeCheck} /> : null}
      </form>
    </>
  );
}

interface InstallLogEntry {
  kind: HarnessInstallEvent["kind"];
  text: string;
}

function RuntimeCheckResult({ result }: { result: HarnessRuntimeVerification }) {
  const kind = result.authenticated ? "success" : "error";
  const title = result.authenticated ? "Bob verified" : "Bob not ready";
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
