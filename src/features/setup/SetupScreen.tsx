import { Button, InlineNotification, PasswordInput } from "@carbon/react";
import {
  ArrowLeft,
  ArrowRight,
  CheckmarkFilled,
  ChatBot,
  Document,
  Folder,
  FolderOpen,
  WarningAltFilled,
} from "@carbon/react/icons";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import {
  setBobApiKey,
  type BobInstallStatus,
} from "../../lib/ipc/settingsClient";
import {
  addWorkspace,
  canUseNativeFolderPicker,
  completeOnboarding,
  selectWorkspaceFolder,
} from "../../lib/ipc/workspaceClient";
import {
  applyImportedFolder,
  importFolderFromPicker,
  type ImportedFile,
} from "../../lib/workspace/folderImport";
import { useWorkspaceStore } from "../../app/workspaceStore";

const browserPreviewWorkspacePath = "/Users/dev/workspace/bob4everyone";

type Screen = "welcome" | "value" | "key" | "folder";
const SCREENS: Screen[] = ["welcome", "value", "key", "folder"];

export function SetupScreen() {
  const bobAuthStatus = useWorkspaceStore((state) => state.bobAuthStatus);
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrateWorkspaces);
  const setBobAuthStatus = useWorkspaceStore((state) => state.setBobAuthStatus);
  const setOnboarding = useWorkspaceStore((state) => state.setOnboarding);
  const workspaces = useWorkspaceStore((state) => state.workspaces);

  async function finishOnboarding() {
    try {
      const next = await completeOnboarding();
      setOnboarding(next);
    } catch {
      setOnboarding({ completedAt: Date.now() });
    }
  }

  const [screen, setScreen] = useState<Screen>(() => {
    if (!bobAuthStatus.configured) return "welcome";
    if (workspaces.length === 0) return "folder";
    return "welcome";
  });
  const [apiKey, setApiKey] = useState("");
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  // Read install status from the store — populated by AppShell's
  // single boot-time probe. Avoids the duplicate IPC fan-out that
  // previously fired the bob-detection probe from every screen
  // that wanted to display its state.
  const installStatus: BobInstallStatus | null = useWorkspaceStore(
    (state) => state.bobInstallStatus,
  );
  const installChecking = installStatus === null;

  async function handleSaveApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiKeyError(null);
    setSavingApiKey(true);
    try {
      const status = await setBobApiKey(apiKey);
      setBobAuthStatus(status);
      setApiKey("");
      setScreen("folder");
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : "Bob API key could not be saved");
    } finally {
      setSavingApiKey(false);
    }
  }

  async function handleChooseFolder() {
    setWorkspaceError(null);
    setWorkspaceNotice(null);
    if (canUseNativeFolderPicker()) {
      const selectedPath = await selectWorkspaceFolder();
      if (!selectedPath) return;
      await openWorkspacePath(selectedPath);
      return;
    }
    // Browser: copy a real folder into the persisted virtual workspace.
    const imported = await importFolderFromPicker();
    if (!imported) return;
    if (imported.files.length === 0) {
      setWorkspaceNotice("No Markdown files were found in that folder.");
      return;
    }
    await openWorkspacePath(`/${imported.folderName}`, imported.files);
  }

  async function openWorkspacePath(path: string, importedFiles?: ImportedFile[]) {
    setWorkspaceError(null);
    setWorkspaceNotice(null);
    setAddingWorkspace(true);
    try {
      const workspaceList = await addWorkspace(path);
      if (importedFiles && workspaceList.activeWorkspaceId) {
        // Populate the virtual workspace BEFORE hydrate sets it active —
        // the scan AppShell then triggers reads the imported files.
        await applyImportedFolder(workspaceList.activeWorkspaceId, importedFiles);
      }
      hydrateWorkspaces(workspaceList);
      await finishOnboarding();
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Workspace could not be opened");
    } finally {
      setAddingWorkspace(false);
    }
  }

  const screenIndex = SCREENS.indexOf(screen);
  const goNext = () => {
    const next = SCREENS[screenIndex + 1];
    if (next) setScreen(next);
  };
  const goBack = () => {
    const prev = SCREENS[screenIndex - 1];
    if (prev) setScreen(prev);
  };

  return (
    <div className="bob-onboard">
      <header className="bob-onboard__topbar">
        <div className="bob-onboard__brand">
          <span className="bob-onboard__mark" aria-hidden="true">
            <ChatBot size={16} />
          </span>
          <span>Compose</span>
        </div>
        <InstallPill checking={installChecking} status={installStatus} />
      </header>

      <main className="bob-onboard__stage">
        {screen === "welcome" ? (
          <WelcomeScreen onStart={goNext} onSkip={() => void finishOnboarding()} />
        ) : null}

        {screen === "value" ? (
          <ValueScreen onBack={goBack} onNext={goNext} />
        ) : null}

        {screen === "key" ? (
          <KeyScreen
            apiKey={apiKey}
            apiKeyError={apiKeyError}
            authError={bobAuthStatus.errorMessage}
            isConfigured={bobAuthStatus.configured}
            onBack={goBack}
            onChange={setApiKey}
            onSubmit={handleSaveApiKey}
            saving={savingApiKey}
          />
        ) : null}

        {screen === "folder" ? (
          <FolderScreen
            adding={addingWorkspace}
            authConfigured={bobAuthStatus.configured}
            error={workspaceError}
            notice={workspaceNotice}
            onBack={goBack}
            onChoose={() => void handleChooseFolder()}
            onUseSample={() => void openWorkspacePath(browserPreviewWorkspacePath)}
          />
        ) : null}
      </main>

      <footer className="bob-onboard__footer">
        <ProgressDots count={SCREENS.length} index={screenIndex} />
      </footer>
    </div>
  );
}

function WelcomeScreen({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <ScreenShell>
      <div className="bob-onboard__hero-mark" aria-hidden="true">
        <ChatBot size={36} />
      </div>
      <h1 className="bob-onboard__title">Welcome to Compose</h1>
      <p className="bob-onboard__lead">
        A local-first Markdown workspace with an AI collaborator alongside. Your files stay on
        disk, and answers stream in next to what you're writing.
      </p>
      <div className="bob-onboard__cta-row">
        <Button kind="primary" renderIcon={ArrowRight} onClick={onStart} size="lg">
          Get started
        </Button>
        <Button kind="ghost" onClick={onSkip} size="lg">
          Skip to dashboard
        </Button>
      </div>
      <p className="bob-onboard__small">Takes about a minute. You can re-run setup from Settings.</p>
    </ScreenShell>
  );
}

function ValueScreen({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <ScreenShell>
      <span className="bob-onboard__eyebrow">What you get</span>
      <h1 className="bob-onboard__title">Three things, working together</h1>
      <div className="bob-onboard__value-grid">
        <ValueProp
          icon={<Document size={20} />}
          title="Your files, on disk"
          body="Pick a folder. Bob reads and writes Markdown there directly — no upload, no sync."
        />
        <ValueProp
          icon={<ChatBot size={20} />}
          title="Bob in the side panel"
          body="Ask about the file you're editing. Bob streams responses without leaving the editor."
        />
        <ValueProp
          icon={<Folder size={20} />}
          title="Multiple workspaces"
          body="Switch between projects in one click. Each has its own files and chat context."
        />
      </div>
      <NavRow onBack={onBack} onNext={onNext} nextLabel="Continue" />
    </ScreenShell>
  );
}

function KeyScreen({
  apiKey,
  apiKeyError,
  authError,
  isConfigured,
  onBack,
  onChange,
  onSubmit,
  saving,
}: {
  apiKey: string;
  apiKeyError: string | null;
  authError?: string;
  isConfigured: boolean;
  onBack: () => void;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  return (
    <ScreenShell>
      <span className="bob-onboard__eyebrow">Step 1 of 2</span>
      <h1 className="bob-onboard__title">Save your Bob API key</h1>
      <p className="bob-onboard__lead">
        Stored locally in your OS keychain. We never see it. Generate one at your Bob console.
      </p>

      <form className="bob-onboard__form" onSubmit={onSubmit}>
        {authError ? (
          <InlineNotification
            hideCloseButton
            kind="error"
            lowContrast
            subtitle={authError}
            title="Credential status"
          />
        ) : null}
        <PasswordInput
          id="bob-api-key"
          labelText=""
          hideLabel
          helperText={
            isConfigured
              ? "Saved. Paste a new key to replace it."
              : "Paste your Bob API key to continue."
          }
          value={apiKey}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="bob_sk_…"
          size="lg"
        />
        {apiKeyError ? (
          <InlineNotification
            hideCloseButton
            kind="error"
            lowContrast
            subtitle={apiKeyError}
            title="Save failed"
          />
        ) : null}
        <NavRow
          onBack={onBack}
          nextLabel={saving ? "Saving" : isConfigured ? "Update and continue" : "Save and continue"}
          nextDisabled={saving || apiKey.trim().length === 0}
          nextType="submit"
        />
      </form>
    </ScreenShell>
  );
}

function FolderScreen({
  adding,
  authConfigured,
  error,
  notice,
  onBack,
  onChoose,
  onUseSample,
}: {
  adding: boolean;
  authConfigured: boolean;
  error: string | null;
  notice: string | null;
  onBack: () => void;
  onChoose: () => void;
  onUseSample: () => void;
}) {
  return (
    <ScreenShell>
      <span className="bob-onboard__eyebrow">Step 2 of 2</span>
      <h1 className="bob-onboard__title">Pick a folder for your notes</h1>
      <p className="bob-onboard__lead">
        Bob reads and writes Markdown files in this folder. You can switch or add more later from
        the sidebar.
      </p>

      <div className="bob-onboard__form">
        <div className="bob-onboard__folder-actions">
          <Button
            kind="primary"
            onClick={onChoose}
            renderIcon={FolderOpen}
            disabled={!authConfigured || adding}
            size="lg"
          >
            Choose folder
          </Button>
          {!canUseNativeFolderPicker() ? (
            <Button
              disabled={adding || !authConfigured}
              kind="tertiary"
              onClick={onUseSample}
              size="lg"
            >
              {adding ? "Opening" : "Use sample workspace"}
            </Button>
          ) : null}
        </div>
        {notice ? (
          <InlineNotification
            hideCloseButton
            kind="info"
            lowContrast
            subtitle={notice}
            title="Browser preview"
          />
        ) : null}
        {error ? (
          <InlineNotification
            hideCloseButton
            kind="error"
            lowContrast
            subtitle={error}
            title="Open failed"
          />
        ) : null}
        <NavRow onBack={onBack} hideNext />
      </div>
    </ScreenShell>
  );
}

function ScreenShell({ children }: { children: ReactNode }) {
  return <section className="bob-onboard__screen">{children}</section>;
}

function ValueProp({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="bob-onboard__value">
      <span className="bob-onboard__value-icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function NavRow({
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled,
  nextType,
  hideNext,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextType?: "submit" | "button";
  hideNext?: boolean;
}) {
  return (
    <div className="bob-onboard__nav">
      {onBack ? (
        <Button kind="ghost" onClick={onBack} renderIcon={ArrowLeft} size="md">
          Back
        </Button>
      ) : (
        <span />
      )}
      {!hideNext ? (
        <Button
          kind="primary"
          onClick={onNext}
          renderIcon={ArrowRight}
          size="md"
          disabled={nextDisabled}
          type={nextType ?? "button"}
        >
          {nextLabel}
        </Button>
      ) : null}
    </div>
  );
}

function ProgressDots({ count, index }: { count: number; index: number }) {
  return (
    <div className="bob-onboard__dots" role="progressbar" aria-valuemin={1} aria-valuemax={count} aria-valuenow={index + 1}>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={[
            "bob-onboard__dot",
            i === index ? "bob-onboard__dot--current" : "",
            i < index ? "bob-onboard__dot--past" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      ))}
    </div>
  );
}

function InstallPill({
  checking,
  status,
}: {
  checking: boolean;
  status: BobInstallStatus | null;
}) {
  if (checking) {
    return (
      <div className="bob-install-pill bob-install-pill--checking" role="status">
        <span className="bob-install-pill__dot" />
        <span>Checking Bob CLI</span>
      </div>
    );
  }
  if (!status) return null;
  if (status.requiresDesktopRuntime) {
    return (
      <div className="bob-install-pill bob-install-pill--warn" role="status">
        <WarningAltFilled size={14} />
        <span>Desktop app required</span>
      </div>
    );
  }
  if (status.installed) {
    const versionLabel = status.version
      ? /^\d/.test(status.version)
        ? `v${status.version}`
        : status.version
      : "detected";
    return (
      <div className="bob-install-pill bob-install-pill--ok" role="status" title={status.path}>
        <CheckmarkFilled size={14} />
        <span>Bob CLI {versionLabel}</span>
      </div>
    );
  }
  return (
    <div className="bob-install-pill bob-install-pill--warn" role="status">
      <WarningAltFilled size={14} />
      <span>Bob CLI missing</span>
    </div>
  );
}
