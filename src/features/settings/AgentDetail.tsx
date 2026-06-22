import { Button, InlineNotification, Tag } from "@carbon/react";
import { ArrowLeft } from "@carbon/react/icons";

import { harnessCapabilitiesOf } from "../../app/workspaceStore";
import { useHarnessStore } from "../../app/store/harnessStore";
import { agentStatus, statusTagType } from "./agentStatus";
import { ExternalHarnessSetup, ManagedHarnessSetup } from "./agentConfigControls";
import { useHarnessSetup } from "./useHarnessSetup";

/**
 * One agent's setup + configuration screen, reached from {@link AgentList}. The
 * setup is capability-driven: a Compose-managed agent (bob) gets the install +
 * key + test panel; everything else gets an install and/or OAuth sign-in step
 * where its status calls for one, then the key form + model/run options. "Set as
 * default" makes this the agent new chats start with (the same preference the
 * footer writes).
 */
export function AgentDetail({ agentId, onBack }: { agentId: string; onBack: () => void }) {
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const selectedHarnessId = useHarnessStore((state) => state.selectedHarnessId);
  const setSelectedHarness = useHarnessStore((state) => state.setSelectedHarness);
  const info = harnessCatalog.find((entry) => entry.id === agentId);
  const caps = harnessCapabilitiesOf(harnessCatalog, agentId);
  const name = info?.displayName ?? agentId;

  const setup = useHarnessSetup(agentId);
  const status = info ? agentStatus(info, setup.readiness) : null;
  const isDefault = agentId === selectedHarnessId;
  const usesManagedSetup = Boolean(info?.requiresInstall && caps.credentialRequired);
  const needsInstall = !setup.readiness?.installed;

  return (
    <div className="agent-detail">
      <div className="settings-section">
        <button type="button" className="agent-detail__back" onClick={onBack}>
          <ArrowLeft aria-hidden />
          Agents
        </button>

        <div className="agent-detail__head">
          <h3>{name}</h3>
          {status ? (
            <Tag size="sm" type={statusTagType(status.tone)}>
              {status.label}
            </Tag>
          ) : null}
          {isDefault ? (
            <Tag size="sm" type="blue">
              Default
            </Tag>
          ) : null}
        </div>
        {info ? <p className="settings-helper">{info.description}</p> : null}

        {!isDefault ? (
          <div className="settings-actions">
            <Button size="sm" kind="tertiary" onClick={() => setSelectedHarness(agentId)}>
              Set as default
            </Button>
          </div>
        ) : null}
      </div>

      {usesManagedSetup ? (
        <ManagedHarnessSetup
          name={name}
          apiKey={setup.apiKey}
          setApiKey={setup.setApiKey}
          authConfigured={setup.managedKeyConfigured}
          needsInstall={needsInstall}
          installing={setup.installing}
          installLog={setup.installLog}
          installResult={setup.installResult}
          logRef={setup.logRef}
          errorMessage={setup.error}
          saveSuccess={setup.saveSuccess}
          saving={setup.saving}
          checkingRuntime={setup.checkingRuntime}
          runtimeCheck={setup.runtimeCheck}
          onInstall={() => void setup.install()}
          onSubmit={setup.saveManagedKey}
          onRuntimeCheck={() => void setup.runRuntimeCheck()}
        />
      ) : (
        <>
          {status?.action === "install" ? <InstallBlock name={name} setup={setup} /> : null}
          {status?.action === "signIn" ? <SignInBlock name={name} setup={setup} /> : null}
          <ExternalHarnessSetup harnessId={agentId} />
        </>
      )}
    </div>
  );
}

type Setup = ReturnType<typeof useHarnessSetup>;

/** Install step for a CLI agent that isn't on disk yet (Claude/Codex). */
function InstallBlock({ name, setup }: { name: string; setup: Setup }) {
  return (
    <div className="settings-section">
      <h3>{name} CLI</h3>
      <p className="settings-helper">{name} runs as a local CLI that isn't installed yet.</p>
      <div className="settings-actions">
        <Button
          size="sm"
          kind="primary"
          disabled={setup.installing}
          onClick={() => void setup.install()}
        >
          {setup.installing ? "Installing…" : `Install ${name}`}
        </Button>
      </div>
      {setup.installLog.length > 0 ? (
        <pre
          ref={setup.logRef}
          className="settings-install-log"
          aria-label={`${name} install progress`}
          aria-live="polite"
        >
          {setup.installLog.map((entry, i) => (
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
      {setup.installResult ? (
        <InlineNotification
          hideCloseButton
          kind={setup.installResult.ok ? "success" : "error"}
          lowContrast
          title={setup.installResult.ok ? `${name} installed` : "Install failed"}
          subtitle={
            setup.installResult.ok
              ? `${name} is ready.`
              : `Exited with code ${setup.installResult.exitCode ?? "?"}. Check the log above.`
          }
        />
      ) : null}
      {setup.error ? (
        <InlineNotification hideCloseButton kind="error" lowContrast subtitle={setup.error} title="Setup error" />
      ) : null}
    </div>
  );
}

/** OAuth sign-in step for an agent that manages its own login (Claude/Codex). */
function SignInBlock({ name, setup }: { name: string; setup: Setup }) {
  return (
    <div className="settings-section">
      <h3>Sign in to {name}</h3>
      <p className="settings-helper">
        {name} manages its own login. Sign in once and Compose uses it for every run.
      </p>
      <div className="settings-actions">
        <Button
          size="sm"
          kind="primary"
          disabled={setup.signingIn}
          onClick={() => void setup.signIn()}
        >
          {setup.signingIn ? "Signing in…" : "Sign in"}
        </Button>
      </div>
      {setup.signingIn ? (
        <InlineNotification
          hideCloseButton
          kind="info"
          lowContrast
          title="Signing in"
          subtitle="Your browser should open — finish signing in there, then this updates automatically."
        />
      ) : null}
      {setup.installLog.length > 0 ? (
        <pre
          ref={setup.logRef}
          className="settings-install-log"
          aria-label={`${name} sign-in progress`}
          aria-live="polite"
        >
          {setup.installLog.map((entry, i) => (
            <div key={i} className="settings-install-log__line">
              {entry.text}
            </div>
          ))}
        </pre>
      ) : null}
      {setup.error ? (
        <InlineNotification hideCloseButton kind="error" lowContrast subtitle={setup.error} title="Sign-in error" />
      ) : null}
    </div>
  );
}
