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
  useWorkspaceStore,
  harnessCapabilitiesOf,
  supportsPermissionMode,
  type HarnessRunOptions,
} from "../../app/workspaceStore";
import {
  checkBobInstall,
  getBobAuthStatus,
  setBobApiKey,
  verifyBobRuntime,
  type BobRuntimeVerification,
} from "../../lib/ipc/settingsClient";
import { installBob, type BobInstallEvent } from "../../lib/ipc/bobShellClient";
import { revealErrorLog } from "../../lib/diagnostics/errorReporter";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { HarnessPicker } from "./HarnessPicker";

/**
 * Settings content — the canonical surface for first-time Bob setup and
 * ongoing maintenance. Rendered either inside a workspace tab (the pane
 * host) or, on the dashboard where there is no tab strip, inside the
 * modal wrapper [SettingsDialog](./SettingsDialog.tsx). It owns no chrome
 * (no backdrop / title bar) so it composes into either host.
 */
export function SettingsPanel() {
  const bobAuthStatus = useWorkspaceStore((state) => state.bobAuthStatus);
  const bobInstallStatus = useWorkspaceStore((state) => state.bobInstallStatus);
  const selectedHarnessId = useWorkspaceStore((state) => state.selectedHarnessId);
  const harnessCatalog = useWorkspaceStore((state) => state.harnessCatalog);
  const setBobAuthStatus = useWorkspaceStore((state) => state.setBobAuthStatus);
  const setBobInstallStatus = useWorkspaceStore((state) => state.setBobInstallStatus);
  const [apiKey, setApiKey] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [runtimeCheck, setRuntimeCheck] = useState<BobRuntimeVerification | null>(null);
  const [checkingRuntime, setCheckingRuntime] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<InstallLogEntry[]>([]);
  const [installResult, setInstallResult] = useState<
    Extract<BobInstallEvent, { kind: "done" }> | null
  >(null);
  const logRef = useRef<HTMLPreElement>(null);

  // Auto-scroll the install log to the bottom as new lines arrive.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [installLog.length]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSaveSuccess(false);
    setSaving(true);
    try {
      const status = await setBobApiKey(apiKey);
      setBobAuthStatus(status);
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
      const result = await verifyBobRuntime();
      setRuntimeCheck(result);
      setBobInstallStatus({
        errorMessage: result.errorMessage,
        installed: result.installed,
        path: result.path,
        requiresDesktopRuntime: result.requiresDesktopRuntime,
        version: result.version,
      });
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
      for await (const event of installBob()) {
        setInstallLog((prev) => [
          ...prev,
          { kind: event.kind, text: "text" in event ? event.text : "" },
        ]);
        if (event.kind === "done") {
          setInstallResult(event);
          const [auth, install] = await Promise.all([getBobAuthStatus(), checkBobInstall()]);
          setBobAuthStatus(auth);
          setBobInstallStatus(install);
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Install failed");
    } finally {
      setInstalling(false);
    }
  }

  const needsInstall = !bobInstallStatus?.installed;

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
          <div className="bob-settings-provider-detail">
            {harnessCapabilitiesOf(harnessCatalog, selectedHarnessId).credentialRequired ? (
              <BobSetup
                apiKey={apiKey}
                setApiKey={setApiKey}
                bobAuthStatus={bobAuthStatus}
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
        </TabPanel>

        {/* ----- About tab ------------------------------- */}
        <TabPanel>
          <div className="bob-settings-section">
            <h3>About Compose</h3>
            <p className="bob-settings-helper">Compose · version 0.1.0</p>
            <p className="bob-settings-helper">
              A local-first AI writing workspace — your notes stay on your computer. AI for
              everyone.
            </p>
            {bobInstallStatus?.nodeVersion ? (
              <p className="bob-settings-helper">Runtime: Node.js {bobInstallStatus.nodeVersion}</p>
            ) : null}
          </div>
          {isTauriRuntime() ? (
            <div className="bob-settings-section">
              <h3>Report a problem</h3>
              <p className="bob-settings-helper">
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
  const harnessCatalog = useWorkspaceStore((state) => state.harnessCatalog);
  const options =
    useWorkspaceStore((state) => state.harnessOptions[harnessId]) ?? ({} as HarnessRunOptions);
  const setHarnessOptions = useWorkspaceStore((state) => state.setHarnessOptions);

  const info = harnessCatalog.find((entry) => entry.id === harnessId);
  const caps = harnessCapabilitiesOf(harnessCatalog, harnessId);
  const name = info?.displayName ?? harnessId;

  return (
    <div className="bob-settings-section">
      <h3>{name} setup</h3>
      <p className="bob-settings-helper">
        {name} uses your existing {name} login — there's nothing to connect here. If it isn't
        installed yet, use the Install button on its card above. Choose a model and run options
        below; leave a field on "Default" to use {name}'s own default.
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
        <p className="bob-settings-helper" style={{ marginBlockStart: "-0.5rem" }}>
          Off (default): changes apply to your files as {name} works, and you can undo any of them
          from a file's “Previous versions”. On: {name} works on a copy and you approve each change
          before it lands — safer to preview, but {name} can't see your real folder or its tools.
        </p>

        {caps.allowsCustomModel ? (
          <TextInput
            id={`${harnessId}-model`}
            labelText="Model"
            placeholder="Default (the CLI decides)"
            value={options.model ?? ""}
            onChange={(event) =>
              setHarnessOptions(harnessId, { model: event.target.value || undefined })
            }
          />
        ) : caps.models.length > 0 ? (
          <Select
            id={`${harnessId}-model`}
            labelText="Model"
            value={options.model ?? ""}
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

interface BobSetupProps {
  apiKey: string;
  setApiKey: (value: string) => void;
  bobAuthStatus: { configured: boolean };
  needsInstall: boolean;
  installing: boolean;
  installLog: InstallLogEntry[];
  installResult: Extract<BobInstallEvent, { kind: "done" }> | null;
  logRef: React.RefObject<HTMLPreElement>;
  errorMessage: string | null;
  saveSuccess: boolean;
  saving: boolean;
  checkingRuntime: boolean;
  runtimeCheck: BobRuntimeVerification | null;
  onInstall: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRuntimeCheck: () => void;
}

function BobSetup(props: BobSetupProps) {
  const {
    apiKey,
    setApiKey,
    bobAuthStatus,
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
      <div className="bob-settings-section">
        <h3>Bob CLI</h3>
        <p className="bob-settings-helper">
          {needsInstall
            ? "Bob runs as a local CLI. Click below to install it via nvm + npm — no sudo needed."
            : "Bob is installed. Reinstall to update to the latest version."}
        </p>
        <div className="bob-settings-actions">
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
            className="bob-settings-install-log"
            aria-label="Bob install progress"
            aria-live="polite"
          >
            {installLog.map((entry, i) => (
              <div
                key={i}
                className={`bob-settings-install-log__line bob-settings-install-log__line--${entry.kind}`}
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
      <form onSubmit={onSubmit} className="bob-settings-section bob-settings-form">
        <h3>Bob API key</h3>
        <PasswordInput
          id="settings-bob-key"
          labelText="Bob API key"
          helperText={
            bobAuthStatus.configured
              ? "Paste a new key to replace the saved one."
              : "Paste your Bob API key. Stored locally in your OS keychain."
          }
          value={apiKey}
          onChange={(event) => setApiKey(event.currentTarget.value)}
          placeholder={bobAuthStatus.configured ? "Replace saved key" : "Paste Bob API key"}
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
        <div className="bob-settings-actions">
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
  kind: BobInstallEvent["kind"];
  text: string;
}

function RuntimeCheckResult({ result }: { result: BobRuntimeVerification }) {
  const kind = result.authenticated ? "success" : "error";
  const title = result.authenticated ? "Bob verified" : "Bob not ready";
  const details = [
    result.path ? `CLI: ${result.path}` : null,
    result.version ? `Version: ${result.version}` : null,
    result.exitCode !== undefined ? `Exit: ${result.exitCode}` : null,
    result.errorMessage,
    result.stdoutPreview ? `stdout: ${result.stdoutPreview}` : null,
    result.stderrPreview ? `stderr: ${result.stderrPreview}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="bob-settings-runtime">
      <InlineNotification hideCloseButton kind={kind} lowContrast subtitle={details} title={title} />
    </div>
  );
}
