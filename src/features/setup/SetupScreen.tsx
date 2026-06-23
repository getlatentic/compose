import { Button, InlineNotification, PasswordInput } from "@carbon/react";
import {
  ArrowLeft,
  ArrowRight,
  ChatBot,
  Document,
  DocumentAdd,
  Folder,
  FolderOpen,
} from "@carbon/react/icons";
import { ComposeMark } from "./ComposeMark";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  harnessCredentialStatus,
  harnessReadiness,
  harnessSetCredential,
} from "../../lib/ipc/harnessClient";
import { createStarterFolder } from "../../lib/ipc/filesClient";
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
import { useHarnessStore } from "../../app/store/harnessStore";
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
  const [addingWorkspace, setAddingWorkspace] = useState(false);

  async function handleChooseFolder() {
    setWorkspaceError(null);
    if (canUseNativeFolderPicker()) {
      const selectedPath = await selectWorkspaceFolder();
      if (!selectedPath) return;
      await openWorkspacePath(selectedPath);
      return;
    }
    // Browser: copy a real folder into the persisted virtual workspace. An
    // empty folder opens too — the editor's welcome state invites the first
    // note rather than turning the user away.
    const imported = await importFolderFromPicker();
    if (!imported) return;
    await openWorkspacePath(`/${imported.folderName}`, imported.files);
  }

  async function openWorkspacePath(path: string, importedFiles?: ImportedFile[]) {
    setWorkspaceError(null);
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

  // The zero-friction default: open a notes folder Compose makes for the user
  // (`~/Documents/Compose`, seeded with a Welcome note) so a first-timer never
  // has to navigate a file dialog. In the browser there's no real filesystem,
  // so fall back to the in-memory sample workspace.
  async function handleStarterFolder() {
    setWorkspaceError(null);
    let starterPath: string | null;
    try {
      starterPath = await createStarterFolder();
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Could not create your notes folder",
      );
      return;
    }
    await openWorkspacePath(starterPath ?? browserPreviewWorkspacePath);
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
    <div className="onboard">
      <header className="onboard__topbar">
        <div className="onboard__brand">
          <span className="onboard__mark" aria-hidden="true">
            <ComposeMark size={16} />
          </span>
          <span>Compose</span>
        </div>
      </header>

      <main className="onboard__stage">
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
            onBack={goBack}
            onStarter={() => void handleStarterFolder()}
            onChoose={() => void handleChooseFolder()}
          />
        ) : null}
      </main>

      <footer className="onboard__footer">
        <ProgressDots count={SCREENS.length} index={screenIndex} />
      </footer>
    </div>
  );
}

function WelcomeScreen({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <ScreenShell>
      <div className="onboard__hero-mark" aria-hidden="true">
        <ComposeMark size={36} />
      </div>
      <h1 className="onboard__title">Welcome to Compose</h1>
      <p className="onboard__lead">
        A local-first Markdown workspace with an AI collaborator alongside. Your files stay on
        disk, and answers stream in next to what you're writing.
      </p>
      <div className="onboard__cta-row">
        <Button kind="primary" renderIcon={ArrowRight} onClick={onStart} size="lg">
          Get started
        </Button>
        <Button kind="ghost" onClick={onSkip} size="lg">
          Skip for now
        </Button>
      </div>
      <p className="onboard__small">Takes about a minute. You can re-run setup from Settings.</p>
    </ScreenShell>
  );
}

function ValueScreen({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <ScreenShell>
      <span className="onboard__eyebrow">What you get</span>
      <h1 className="onboard__title">Three things, working together</h1>
      <div className="onboard__value-grid">
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
  const selectedHarnessId = useHarnessStore((state) => state.selectedHarnessId);
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const setSelectedHarnessReadiness = useHarnessStore((state) => state.setSelectedHarnessReadiness);

  // Capability-driven, never an id check: a key field appears when the SELECTED
  // harness stores its credential with Compose and none is saved yet — probed
  // against that harness, so switching the selection re-checks the right key.
  const [keyConfigured, setKeyConfigured] = useState(false);
  useEffect(() => {
    let active = true;
    void harnessCredentialStatus(selectedHarnessId)
      .then((status) => {
        if (active) setKeyConfigured(status.configured);
      })
      .catch(() => {
        if (active) setKeyConfigured(false);
      });
    return () => {
      active = false;
    };
  }, [selectedHarnessId]);

  const needsKey =
    harnessCapabilitiesOf(harnessCatalog, selectedHarnessId).credentialRequired && !keyConfigured;

  async function handleKeySaved() {
    const [status, readiness] = await Promise.all([
      harnessCredentialStatus(selectedHarnessId).catch(() => ({ configured: false })),
      harnessReadiness(selectedHarnessId).catch(() => null),
    ]);
    setKeyConfigured(status.configured);
    setSelectedHarnessReadiness(readiness);
  }

  return (
    <ScreenShell>
      <span className="onboard__eyebrow">Step 3 of 4</span>
      <h1 className="onboard__title">Choose your AI</h1>
      <p className="onboard__lead">
        Compose works with the AI agents already on your computer. We checked for the ones we
        support — pick one below. You can change this anytime in Settings.
      </p>

      {desktop ? (
        <HarnessPicker autoSuggestDefault />
      ) : (
        <InlineNotification
          hideCloseButton
          kind="info"
          lowContrast
          title="Browser preview"
          subtitle="Browser preview works with bob. The desktop app also detects Claude Code and Codex on your machine."
        />
      )}

      {needsKey ? (
        <HarnessKeyForm harnessId={selectedHarnessId} onSaved={handleKeySaved} />
      ) : null}

      <NavRow onBack={onBack} onNext={onNext} nextLabel="Continue" />
    </ScreenShell>
  );
}

/**
 * Inline API-key entry, shown on the "Choose your AI" step only when the
 * selected harness stores its credential with Compose and none is saved yet.
 * Optional — the user can also add it later in Settings.
 */
function HarnessKeyForm({
  harnessId,
  onSaved,
}: {
  harnessId: string;
  onSaved: () => void | Promise<void>;
}) {
  const displayName =
    useHarnessStore((state) => state.harnessCatalog.find((entry) => entry.id === harnessId))
      ?.displayName ?? harnessId;
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await harnessSetCredential(harnessId, apiKey);
      setApiKey("");
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "API key could not be saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="onboard__form" onSubmit={submit}>
      <PasswordInput
        id="harness-api-key"
        labelText={`${displayName} API key`}
        helperText="Stored in your OS keychain — we never see it."
        value={apiKey}
        onChange={(event) => setApiKey(event.currentTarget.value)}
        placeholder="API key"
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
  onBack,
  onStarter,
  onChoose,
}: {
  adding: boolean;
  error: string | null;
  onBack: () => void;
  onStarter: () => void;
  onChoose: () => void;
}) {
  return (
    <ScreenShell>
      <span className="onboard__eyebrow">Step 4 of 4</span>
      <h1 className="onboard__title">Where your notes live</h1>
      <p className="onboard__lead">
        Compose can set up a notes folder for you, or you can use one you already have. Either way
        your files stay on your computer, and you can add more folders later.
      </p>

      <div className="onboard__form">
        <div className="onboard__folder-actions">
          <Button
            kind="primary"
            onClick={onStarter}
            renderIcon={DocumentAdd}
            disabled={adding}
            size="lg"
          >
            {adding ? "Setting up…" : "Start with a starter folder"}
          </Button>
          <Button
            kind="tertiary"
            onClick={onChoose}
            renderIcon={FolderOpen}
            disabled={adding}
            size="lg"
          >
            Add your own folder
          </Button>
        </div>
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
  return <section className="onboard__screen">{children}</section>;
}

function ValueProp({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="onboard__value">
      <span className="onboard__value-icon" aria-hidden="true">
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
    <div className="onboard__nav">
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
    <div className="onboard__dots" role="progressbar" aria-valuemin={1} aria-valuemax={count} aria-valuenow={index + 1}>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={[
            "onboard__dot",
            i === index ? "onboard__dot--current" : "",
            i < index ? "onboard__dot--past" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      ))}
    </div>
  );
}

