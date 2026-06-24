import { Button, InlineNotification } from "@carbon/react";
import { DocumentAdd, FolderOpen } from "@carbon/react/icons";
import { useEffect, useRef, useState } from "react";
import { SplashScreen } from "../../app/SplashScreen";
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
import { useWorkspaceStore } from "../../app/workspaceStore";

// Browser-preview only: the virtual "sample workspace" id (the path is just an
// identifier in the browser — no disk access). Overridable for local dev.
const browserPreviewWorkspacePath =
  import.meta.env.VITE_SAMPLE_WORKSPACE ?? "/sample-vault";

/**
 * First-run setup — deliberately NOT a landing page. On first launch it silently
 * creates the starter notes folder (`~/Compose`, a home-folder path so there's no
 * macOS permission prompt) and drops the user straight into the editor; the
 * seeded Welcome note + the chat's suggestions ARE the onboarding. The agent
 * default resolves in the background at boot (AppRouter → resolveDefaultHarness),
 * so the AI is set up without a step, and "use my own folder" lives in the
 * top-bar workspace menu. A folder PICK is shown here only as a fallback, if the
 * starter folder can't be created.
 */
export function SetupScreen() {
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrateWorkspaces);
  const setOnboarding = useWorkspaceStore((state) => state.setOnboarding);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Reveal the folder pick only if the zero-friction starter folder fails.
  const [needsFolderPick, setNeedsFolderPick] = useState(false);

  async function finishOnboarding() {
    try {
      const next = await completeOnboarding();
      setOnboarding(next);
    } catch {
      setOnboarding({ completedAt: Date.now() });
    }
  }

  async function openWorkspacePath(
    path: string,
    importedFiles?: ImportedFile[],
  ): Promise<boolean> {
    setWorkspaceError(null);
    setBusy(true);
    try {
      const workspaceList = await addWorkspace(path);
      if (importedFiles && workspaceList.activeWorkspaceId) {
        // Populate the virtual workspace BEFORE hydrate sets it active —
        // the scan AppShell then triggers reads the imported files.
        await applyImportedFolder(workspaceList.activeWorkspaceId, importedFiles);
      }
      hydrateWorkspaces(workspaceList);
      await finishOnboarding();
      return true;
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Workspace could not be opened");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Create (or reuse) the `~/Compose` starter folder and open it. Resolves false
  // if it can't be set up, so the caller can fall back to a folder pick.
  async function handleStarterFolder(): Promise<boolean> {
    setWorkspaceError(null);
    let starterPath: string | null;
    try {
      starterPath = await createStarterFolder();
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Could not create your notes folder",
      );
      return false;
    }
    return openWorkspacePath(starterPath ?? browserPreviewWorkspacePath);
  }

  async function handleChooseFolder() {
    setWorkspaceError(null);
    if (canUseNativeFolderPicker()) {
      const selectedPath = await selectWorkspaceFolder();
      if (!selectedPath) return;
      await openWorkspacePath(selectedPath);
      return;
    }
    const imported = await importFolderFromPicker();
    if (!imported) return;
    await openWorkspacePath(`/${imported.folderName}`, imported.files);
  }

  // First launch: skip the landing page — set up the starter folder and go
  // straight to the editor. Only on failure do we surface the folder pick.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void handleStarterFolder().then((ok) => {
      if (!ok) setNeedsFolderPick(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!needsFolderPick) {
    // Setting up (then onboarding completes and AppRouter swaps in the editor) —
    // hold the splash so there's no flash of empty UI.
    return <SplashScreen />;
  }

  return (
    <div className="onboard">
      <div className="onboard__topbar" aria-hidden="true" />
      <main className="onboard__stage">
        <section className="onboard__screen">
          <h1 className="onboard__title">Where your notes live</h1>
          <p className="onboard__lead">
            We couldn't set up a notes folder automatically. Pick one to get started — your files
            stay on your computer, and you can add more later.
          </p>
          <div className="onboard__form">
            <div className="onboard__folder-actions">
              <Button
                kind="primary"
                onClick={() => void handleStarterFolder()}
                renderIcon={DocumentAdd}
                disabled={busy}
                size="lg"
              >
                {busy ? "Setting up…" : "Use a Compose folder"}
              </Button>
              <Button
                kind="tertiary"
                onClick={() => void handleChooseFolder()}
                renderIcon={FolderOpen}
                disabled={busy}
                size="lg"
              >
                Open your own folder
              </Button>
            </div>
            {workspaceError ? (
              <InlineNotification
                hideCloseButton
                kind="error"
                lowContrast
                subtitle={workspaceError}
                title="Open failed"
              />
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
