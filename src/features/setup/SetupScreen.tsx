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
  type BobAuthStatus,
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
import { harnessCapabilitiesOf, useWorkspaceStore } from "../../app/workspaceStore";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { HarnessPicker } from "../settings/HarnessPicker";

// Browser-preview only: the virtual "sample workspace" id (the path is just an
// identifier in the browser — no disk access). Overridable for local dev.
const browserPreviewWorkspacePath =
  import.meta.env.VITE_SAMPLE_WORKSPACE ?? "/sample-vault";

type Screen = "welcome" | "value" | "choose" | "folder";
const SCREENS: Screen[] = ["welcome", "value", "choose", "folder"];

export function SetupScreen() {
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrateWorkspaces);
  const setOnboarding = useWorkspaceStore((state) => state.setOnboarding);

  async function finishOnboarding() {
    try {
      const next = await completeOnboarding();
      setOnboarding(next);
    } catch {
      setOnboarding({ completedAt: Date.now() });
    }
  }

  const [screen, setScreen] = useState<Screen>("welcome");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  // Read install status from the store — populated by AppShell's
  // single boot-time probe. Avoids the duplicate IPC fan-out that
  // previously fired the bob-detection probe from every screen
  // that wanted to display its state.
  const installStatus: BobInstallStatus | null = useWorkspaceStore(
    (state) => state.bobInstallStatus,
  );
  const installChecking = installStatus === null;

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

        {screen === "choose" ? (
          <ChooseAiScreen onBack={goBack} onNext={goNext} />
        ) : null}

        {screen === "folder" ? (
          <FolderScreen
            adding={addingWorkspace}
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
          body="Pick a folder. Your AI assistant reads and writes Markdown there directly — no upload, no sync."
        />
        <ValueProp
          icon={<ChatBot size={20} />}
          title="AI in the side panel"
          body="Ask about the file you're editing. Answers stream in without leaving the editor."
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

/**
 * "Choose your AI" — the harness auto-discovery step. The detection-driven
 * {@link HarnessPicker} lists the registered harnesses and probes each one's
 * readiness, so a user sees the AI agents already on their machine ("Ready ✓")
 * versus ones to install or sign into — no assumption that they use bob. When
 * the selected harness stores its credential with Compose (bob), an inline key
 * field appears; everything else (Claude Code / Codex login) is handled inside
 * the picker. This step never blocks: a user can finish setup now and complete
 * any AI sign-in later from Settings.
 */
function ChooseAiScreen({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const desktop = isTauriRuntime();
  const selectedHarnessId = useWorkspaceStore((state) => state.selectedHarnessId);
  const harnessCatalog = useWorkspaceStore((state) => state.harnessCatalog);
  const bobAuthStatus = useWorkspaceStore((state) => state.bobAuthStatus);
  const setBobAuthStatus = useWorkspaceStore((state) => state.setBobAuthStatus);

  // Capability-driven, never an id check: a harness whose credential Compose
  // stores (bob) needs a key here. `harnessCapabilitiesOf` falls back to the
  // default harness's capabilities when the catalog is empty (browser preview),
  // so the bob key field still appears there.
  const needsKey =
    harnessCapabilitiesOf(harnessCatalog, selectedHarnessId).credentialRequired &&
    !bobAuthStatus.configured;

  return (
    <ScreenShell>
      <span className="bob-onboard__eyebrow">Step 1 of 2</span>
      <h1 className="bob-onboard__title">Choose your AI</h1>
      <p className="bob-onboard__lead">
        Compose works with the AI agents already on your computer. We checked for the ones we
        support — pick one below. You can change this anytime in Settings.
      </p>

      {desktop ? (
        <HarnessPicker />
      ) : (
        <InlineNotification
          hideCloseButton
          kind="info"
          lowContrast
          title="Browser preview"
          subtitle="Browser preview works with bob. The desktop app also detects Claude Code and Codex on your machine."
        />
      )}

      {needsKey ? <BobKeyForm onSaved={setBobAuthStatus} /> : null}

      <NavRow onBack={onBack} onNext={onNext} nextLabel="Continue" />
    </ScreenShell>
  );
}

/**
 * Inline bob API-key entry, shown on the "Choose your AI" step only when the
 * selected harness stores its credential with Compose and none is saved yet.
 * Optional — the user can also add it later in Settings.
 */
function BobKeyForm({ onSaved }: { onSaved: (status: BobAuthStatus) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const status = await setBobApiKey(apiKey);
      onSaved(status);
      setApiKey("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bob API key could not be saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="bob-onboard__form" onSubmit={submit}>
      <PasswordInput
        id="bob-api-key"
        labelText="bob API key"
        helperText="Stored in your OS keychain — we never see it. Generate one in your bob console."
        value={apiKey}
        onChange={(event) => setApiKey(event.currentTarget.value)}
        placeholder="bob_sk_…"
        size="md"
      />
      {error ? (
        <InlineNotification
          hideCloseButton
          kind="error"
          lowContrast
          subtitle={error}
          title="Save failed"
        />
      ) : null}
      <div>
        <Button
          kind="tertiary"
          size="md"
          type="submit"
          disabled={saving || apiKey.trim().length === 0}
        >
          {saving ? "Saving…" : "Save key"}
        </Button>
      </div>
    </form>
  );
}

function FolderScreen({
  adding,
  error,
  notice,
  onBack,
  onChoose,
  onUseSample,
}: {
  adding: boolean;
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
        Your AI assistant reads and writes Markdown files in this folder. You can switch or add
        more later from the sidebar.
      </p>

      <div className="bob-onboard__form">
        <div className="bob-onboard__folder-actions">
          <Button
            kind="primary"
            onClick={onChoose}
            renderIcon={FolderOpen}
            disabled={adding}
            size="lg"
          >
            Choose folder
          </Button>
          {!canUseNativeFolderPicker() ? (
            <Button disabled={adding} kind="tertiary" onClick={onUseSample} size="lg">
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
