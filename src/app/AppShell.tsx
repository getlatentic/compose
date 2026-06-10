import {
  Header,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderName,
  SkipToContent,
  ToastNotification,
} from "@carbon/react";
import {
  ChatBot,
  Chat,
  DocumentAdd,
  Home,
  Settings,
} from "@carbon/react/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatPanel } from "../features/chat/ChatPanel";
import {
  CommentsPanel,
  type EditorSelectionSnapshot,
} from "../features/comments/CommentsPanel";
import type { SourceRange } from "../features/comments/commentModel";
import { TiptapMarkdownEditor } from "../features/editor/TiptapMarkdownEditor";
import { PaneTabs, type EditorTab } from "../features/editor/PaneTabs";
import { VersionHistory } from "../features/history/VersionHistory";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { useMarkdownPreview } from "../features/editor/useMarkdownPreview";
import { DashboardScreen } from "../features/dashboard/DashboardScreen";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { SetupScreen } from "../features/setup/SetupScreen";
import { WorkspaceSidebar } from "../features/workspace/WorkspaceSidebar";
import { exportMarkdownFile } from "../lib/export/markdownExport";
import { exportDocumentToPdf } from "../lib/export/pdfExport";
import { exportDocumentToHtml } from "../lib/export/htmlExport";
import type { DocumentExportFormat } from "../features/editor/EditorFileActions";
import { MarkdownLinkContext } from "../lib/markdown/workspaceLinks";
import { subscribeToWorkspaceFs } from "../lib/ipc/fileWatcherClient";
import { checkBobInstall, getBobAuthStatus } from "../lib/ipc/settingsClient";
import { getOnboarding, listWorkspaces } from "../lib/ipc/workspaceClient";
import { useWorkspaceStore } from "./workspaceStore";

export function AppShell() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const addCommentToActiveFile = useWorkspaceStore((state) => state.addCommentToActiveFile);
  const chatOpen = useWorkspaceStore((state) => state.chatOpen);
  const commentsOpen = useWorkspaceStore((state) => state.commentsOpen);
  const editorMode = useWorkspaceStore((state) => state.editorMode);
  const toggleEditorMode = useWorkspaceStore((state) => state.toggleEditorMode);
  const toggleComments = useWorkspaceStore((state) => state.toggleComments);
  const closeFileTab = useWorkspaceStore((state) => state.closeFileTab);
  const createNote = useWorkspaceStore((state) => state.createNote);
  const dismissConflict = useWorkspaceStore((state) => state.dismissConflict);
  const handleFsEvent = useWorkspaceStore((state) => state.handleFsEvent);
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrateWorkspaces);
  const loadHarnessCatalog = useWorkspaceStore((state) => state.loadHarnessCatalog);
  const loadActiveWorkspaceFiles = useWorkspaceStore((state) => state.loadActiveWorkspaceFiles);
  const reloadActiveFile = useWorkspaceStore((state) => state.reloadActiveFile);
  const saveActiveFile = useWorkspaceStore((state) => state.saveActiveFile);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const sendCommentToChat = useWorkspaceStore((state) => state.sendCommentToChat);
  const askBobAboutSelectionStream = useWorkspaceStore(
    (state) => state.askBobAboutSelectionStream,
  );
  const setBobAuthStatus = useWorkspaceStore((state) => state.setBobAuthStatus);
  const setBobInstallStatus = useWorkspaceStore((state) => state.setBobInstallStatus);
  const setOnboarding = useWorkspaceStore((state) => state.setOnboarding);
  // Read the underlying field instead of calling the
  // `onboardingComplete()` method. Calling a method inside a
  // Zustand selector re-runs the method body on every store
  // mutation (every chat token, every fs event, every autosave)
  // and — more importantly — masks any future internal logic
  // change behind a re-render no-op. Reading the field directly
  // makes the dependency explicit and lets useSyncExternalStore
  // bail cleanly when the boolean doesn't change.
  const onboardingComplete = useWorkspaceStore((state) => Boolean(state.onboarding.completedAt));
  const switchWorkspace = useWorkspaceStore((state) => state.switchWorkspace);
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const showDashboard = useWorkspaceStore((state) => state.showDashboard);
  const toggleChat = useWorkspaceStore((state) => state.toggleChat);
  const updateActiveContent = useWorkspaceStore((state) => state.updateActiveContent);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );
  const activeFileBuffer =
    activeWorkspace?.activeFilePath
      ? activeWorkspace.fileContents[activeWorkspace.activeFilePath] ?? null
      : null;
  const activeFileEntry =
    activeWorkspace?.activeFilePath
      ? activeWorkspace.files.find(
          (entry) => entry.relativePath === activeWorkspace.activeFilePath,
        ) ?? null
      : null;
  const preview = useMarkdownPreview(activeFileBuffer?.content ?? "");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [exportNotice, setExportNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const settingsOpen = useWorkspaceStore((state) => state.settingsOpen);
  const openSettings = useWorkspaceStore((state) => state.openSettings);
  const closeSettings = useWorkspaceStore((state) => state.closeSettings);
  const selectPane = useWorkspaceStore((state) => state.selectPane);
  const closePane = useWorkspaceStore((state) => state.closePane);
  // The active non-file pane (Settings, …) when one is the active tab.
  const activePaneId = activeWorkspace?.activePaneId ?? null;
  const activePane =
    activeWorkspace?.openPanes.find((pane) => pane.id === activePaneId) ?? null;
  const [selectionSnapshot, setSelectionSnapshot] = useState<EditorSelectionSnapshot | null>(null);
  // Stabilize the editor's Ask callback so `React.memo` on
  // <TiptapMarkdownEditor /> can short-circuit re-renders. Without
  // useCallback, every render of AppShell creates a fresh arrow
  // function → memo sees "props changed" → editor re-renders
  // even when chat state was the only thing that moved.
  const handleAskAboutSelection = useCallback(
    (question: string, selection: { range: SourceRange; text: string }) => {
      void askBobAboutSelectionStream(question, selection);
    },
    [askBobAboutSelectionStream],
  );
  const activeFileComments = useMemo(() => {
    if (!activeWorkspace?.activeFilePath) {
      return [];
    }
    return activeWorkspace.comments.filter(
      (comment) =>
        comment.filePath === activeWorkspace.activeFilePath && comment.status === "open",
    );
  }, [activeWorkspace?.activeFilePath, activeWorkspace?.comments]);
  const openTabs = useMemo<EditorTab[]>(() => {
    if (!activeWorkspace) {
      return [];
    }

    const tabs: EditorTab[] = [];
    for (const filePath of activeWorkspace.openFilePaths) {
      const entry = activeWorkspace.files.find((file) => file.relativePath === filePath);
      if (!entry) {
        continue;
      }
      const bufferOrUndefined: typeof activeWorkspace.fileContents[string] | undefined =
        activeWorkspace.fileContents[filePath];
      tabs.push({ buffer: bufferOrUndefined ?? null, entry });
    }
    return tabs;
  }, [activeWorkspace]);

  useEffect(() => {
    let cancelled = false;

    async function loadSetupState() {
      try {
        const [authStatus, installStatus, workspaceList, onboarding] = await Promise.all([
          getBobAuthStatus(),
          checkBobInstall(),
          listWorkspaces(),
          getOnboarding(),
        ]);
        if (cancelled) {
          return;
        }

        setBobAuthStatus(authStatus);
        setBobInstallStatus(installStatus);
        hydrateWorkspaces(workspaceList);
        setOnboarding(onboarding);
      } catch (error) {
        if (!cancelled) {
          setBobAuthStatus({
            configured: false,
            errorMessage: error instanceof Error ? error.message : "Setup state could not be loaded",
          });
        }
      }
    }

    void loadSetupState();
    // Load the harness capability catalog once — drives credential
    // gating and the per-harness options UI declaratively.
    void loadHarnessCatalog();

    return () => {
      cancelled = true;
    };
  }, [hydrateWorkspaces, loadHarnessCatalog, setBobAuthStatus, setBobInstallStatus, setOnboarding]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    void loadActiveWorkspaceFiles();
  }, [activeWorkspaceId, loadActiveWorkspaceFiles]);

  useEffect(() => {
    setSelectionSnapshot(null);
  }, [activeWorkspace?.activeFilePath]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    subscribeToWorkspaceFs(activeWorkspaceId, (event) => {
      void handleFsEvent(activeWorkspaceId, event);
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          unsubscribe = unlisten;
        }
      })
      .catch(() => {
        // ignore — fs events are best-effort
      });

    return () => {
      cancelled = true;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [activeWorkspaceId, handleFsEvent]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isSaveShortcut =
        (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === "s";
      if (!isSaveShortcut) {
        return;
      }
      event.preventDefault();
      void saveActiveFile();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveActiveFile]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      const hasDirty = useWorkspaceStore
        .getState()
        .workspaces.some((workspace) =>
          Object.values(workspace.fileContents).some((buffer) => buffer.dirty),
        );
      if (!hasDirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function handleCloseTab(filePath: string) {
    const workspace = useWorkspaceStore.getState().activeWorkspace();
    const buffer = workspace?.fileContents[filePath];
    if (buffer?.dirty) {
      const confirmed = window.confirm(
        `${filePath} has unsaved changes. Close the tab without saving?`,
      );
      if (!confirmed) {
        return;
      }
    }
    closeFileTab(filePath);
  }

  const parseStatus = useMemo(() => {
    if (preview.status === "ready") {
      return `${preview.document.meta.wordCount} words`;
    }

    if (preview.status === "failed") {
      return "Parse failed";
    }

    return "Worker parsing";
  }, [preview]);

  // Cross-file link navigation: the set of workspace files a link can resolve
  // to, and the action to open one. Shared by the editor (modifier-click) and
  // chat replies (click) so a `[text](other.md)` link opens the file in a tab.
  //
  // These hooks (and runDocumentExport) MUST stay ABOVE the early returns
  // below: React requires the same hooks in the same order every render, and
  // the onboarding / no-workspace branches return early. (A blank-screen crash
  // — "Rendered more hooks than during the previous render" — is what moving
  // them below caused.)
  const linkTargets = useMemo(
    () => new Set((activeWorkspace?.files ?? []).map((file) => file.relativePath)),
    [activeWorkspace?.files],
  );
  const navigateToFile = useCallback(
    (path: string) => {
      void selectFile(path);
    },
    [selectFile],
  );
  const chatLinkContext = useMemo(
    () => ({ navigate: navigateToFile, knownPaths: linkTargets }),
    [navigateToFile, linkTargets],
  );

  // File-action callbacks passed into the (memoized) editor toolbar. They MUST
  // be referentially stable, so they read live state via the store rather than
  // close over the per-keystroke buffer.
  const handleShowVersionHistory = useCallback(() => setVersionHistoryOpen(true), []);
  const handleExport = useCallback(async (format: DocumentExportFormat) => {
    const workspace = useWorkspaceStore.getState().activeWorkspace();
    const relativePath = workspace?.activeFilePath;
    const buffer = relativePath ? workspace.fileContents[relativePath] : undefined;
    if (!workspace || !relativePath || !buffer) {
      return;
    }
    if (format === "markdown") {
      exportMarkdownFile({ filePath: relativePath, markdown: buffer.content });
      return;
    }
    const exporter = format === "html" ? exportDocumentToHtml : exportDocumentToPdf;
    const result = await exporter({ workspaceId: workspace.id, relativePath, content: buffer.content });
    if (result.status === "cancelled") {
      return;
    }
    setExportNotice(
      result.status === "exported"
        ? { kind: "success", text: `Saved to ${result.path}` }
        : { kind: "error", text: result.message },
    );
  }, []);

  if (!onboardingComplete) {
    return <SetupScreen />;
  }

  // No workspace yet — just the Dashboard. There's nothing
  // workspace-related to keep mounted, so the simple early-return
  // is fine.
  if (!activeWorkspace) {
    return (
      <>
        <DashboardScreen
          onOpenSettings={() => openSettings()}
          onOpenWorkspace={(workspaceId) => switchWorkspace(workspaceId)}
        />
        {settingsOpen ? <SettingsDialog onClose={() => closeSettings()} /> : null}
      </>
    );
  }

  // Workspace exists. Render BOTH the dashboard and the workspace
  // shell, gating visibility with CSS. This is the
  // perf-critical optimisation flagged by the audit: previously
  // clicking the Home icon flipped `viewMode` to "dashboard" and
  // unmounted the entire workspace tree (TipTap editor, chat
  // panel, file watcher). The TipTap remount alone is a
  // multi-hundred-millisecond stall on a non-trivial document.
  // Keeping the tree mounted under `display: none` preserves all
  // in-memory state and snaps back instantly when the user
  // returns to the workspace.
  const dashboardVisible = viewMode === "dashboard";

  const statusDirty = Boolean(activeFileBuffer?.dirty);
  const statusMeta = activeFileEntry
    ? statusDirty
      ? "Unsaved"
      : parseStatus
    : "";

  return (
    <>
      {exportNotice ? (
        <ToastNotification
          kind={exportNotice.kind}
          lowContrast
          title={exportNotice.kind === "success" ? "PDF exported" : "Export failed"}
          subtitle={exportNotice.text}
          timeout={6000}
          onClose={() => {
            setExportNotice(null);
            return true;
          }}
          style={{
            position: "fixed",
            right: "1rem",
            bottom: "1rem",
            zIndex: 9000,
            maxWidth: "28rem",
          }}
        />
      ) : null}
      {/* Dashboard rendered alongside, hidden via CSS so its
        * state survives the toggle. `display: none` drops it
        * out of layout without unmounting. */}
      <div style={{ display: dashboardVisible ? "contents" : "none" }}>
        <DashboardScreen
          onOpenSettings={() => openSettings()}
          onOpenWorkspace={(workspaceId) => switchWorkspace(workspaceId)}
        />
      </div>
      <div
        className="bob-app-shell"
        style={{ display: dashboardVisible ? "none" : "flex" }}
      >
      <Header aria-label="Compose">
        <SkipToContent />
        <HeaderName href="#main-content" prefix="">
          Compose
        </HeaderName>
        <HeaderGlobalBar>
          <HeaderGlobalAction
            aria-label="Home"
            onClick={showDashboard}
            tooltipAlignment="end"
          >
            <Home size={20} />
          </HeaderGlobalAction>
          <HeaderGlobalAction
            aria-label="New note"
            onClick={() => void createNote()}
            tooltipAlignment="end"
          >
            <DocumentAdd size={20} />
          </HeaderGlobalAction>
          <HeaderGlobalAction
            aria-label="Settings"
            onClick={() => openSettings()}
            tooltipAlignment="end"
          >
            <Settings size={20} />
          </HeaderGlobalAction>
          <HeaderGlobalAction
            aria-label={
              commentsOpen
                ? "Hide comments"
                : activeFileComments.length > 0
                  ? `Show comments (${activeFileComments.length})`
                  : "Show comments"
            }
            className={commentsOpen ? "bob-header-action--open" : undefined}
            onClick={toggleComments}
            tooltipAlignment="end"
          >
            <Chat size={20} />
          </HeaderGlobalAction>
          <HeaderGlobalAction
            aria-label={chatOpen ? "Hide Bob" : "Open Bob"}
            className={chatOpen ? "bob-header-action--open" : undefined}
            onClick={toggleChat}
            tooltipAlignment="end"
          >
            <ChatBot size={20} />
          </HeaderGlobalAction>
        </HeaderGlobalBar>
      </Header>

      <div className={["bob-workspace", chatOpen ? "bob-workspace--chat-open" : ""].join(" ")}>
        <WorkspaceSidebar />

        <main id="main-content" className="bob-editor-region">
          <PaneTabs
            files={openTabs}
            activeFilePath={activeWorkspace?.activeFilePath ?? ""}
            activePaneId={activePaneId}
            panes={activeWorkspace?.openPanes ?? []}
            onSelectFile={(path) => void selectFile(path)}
            onCloseFile={handleCloseTab}
            onSelectPane={(id) => selectPane(id)}
            onClosePane={(id) => closePane(id)}
          />
          {activeFileBuffer?.conflict ? (
            <div className="bob-conflict-banner" role="alert">
              <span>
                {activeFileEntry?.relativePath} was changed on disk since you opened it.
              </span>
              <div className="bob-conflict-banner__actions">
                <button
                  type="button"
                  className="bob-link-button"
                  onClick={() => void reloadActiveFile()}
                >
                  Reload from disk
                </button>
                <button
                  type="button"
                  className="bob-link-button"
                  onClick={() =>
                    activeFileEntry && dismissConflict(activeFileEntry.relativePath)
                  }
                >
                  Keep my changes
                </button>
              </div>
            </div>
          ) : null}
          <div className="bob-editor-body">
            {activePaneId ? (
              // A non-file pane (Settings, …) is the active tab. Only the
              // active pane is mounted — the editor unmounts and remounts
              // from its cached buffer when you switch back to a file tab.
              <div className="bob-pane-host">
                {activePane?.kind === "settings" ? (
                  <SettingsPanel />
                ) : (
                  <div className="bob-empty-state">
                    <div>
                      <p className="bob-empty-state__title">{activePane?.title ?? "Pane"}</p>
                      <p>This pane type isn't available yet.</p>
                    </div>
                  </div>
                )}
              </div>
            ) : activeFileEntry && activeFileBuffer ? (
              <div
                className={[
                  "bob-document-workspace",
                  commentsOpen ? "bob-document-workspace--comments-open" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <TiptapMarkdownEditor
                  comments={activeFileComments}
                  mode={editorMode}
                  value={activeFileBuffer.content}
                  workspaceId={activeWorkspaceId ?? undefined}
                  workspaceRoot={activeWorkspace?.path ?? undefined}
                  filePath={activeWorkspace?.activeFilePath ?? undefined}
                  linkTargets={linkTargets}
                  onNavigateToLink={navigateToFile}
                  onChange={updateActiveContent}
                  onSelectionChange={setSelectionSnapshot}
                  onAskAboutSelection={handleAskAboutSelection}
                  onSave={saveActiveFile}
                  onShowVersionHistory={handleShowVersionHistory}
                  onExport={handleExport}
                />
                {commentsOpen ? (
                  <CommentsPanel
                    comments={activeFileComments}
                    filePath={activeWorkspace.activeFilePath}
                    selection={selectionSnapshot}
                    onCreateComment={(body, selection) =>
                      addCommentToActiveFile({
                        body,
                        range: selection.range,
                        selectedText: selection.text,
                      })
                    }
                    onSendComment={(commentId) => void sendCommentToChat(commentId)}
                  />
                ) : null}
              </div>
            ) : activeFileEntry ? (
              <div className="bob-empty-state">
                <div>
                  <p className="bob-empty-state__title">Loading file…</p>
                </div>
              </div>
            ) : (
              <div className="bob-empty-state">
                <div>
                  <p className="bob-empty-state__title">No file open</p>
                  <p>Choose a Markdown file from the workspace sidebar.</p>
                </div>
              </div>
            )}
          </div>
          {activePaneId ? null : (
          <div className="bob-status-bar">
            <span className="bob-status-bar__path">
              {activeFileEntry?.relativePath ?? activeWorkspace?.path ?? ""}
            </span>
            <span className="bob-status-bar__meta">
              {activeFileEntry ? (
                <span className="bob-mode-toggle" role="group" aria-label="Editor mode">
                  <button
                    type="button"
                    className={[
                      "bob-mode-toggle__option",
                      editorMode === "wysiwyg" ? "bob-mode-toggle__option--active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-pressed={editorMode === "wysiwyg"}
                    onClick={() => {
                      if (editorMode !== "wysiwyg") toggleEditorMode();
                    }}
                  >
                    WYSIWYG
                  </button>
                  <button
                    type="button"
                    className={[
                      "bob-mode-toggle__option",
                      editorMode === "source" ? "bob-mode-toggle__option--active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-pressed={editorMode === "source"}
                    onClick={() => {
                      if (editorMode !== "source") toggleEditorMode();
                    }}
                  >
                    Source
                  </button>
                </span>
              ) : null}
              {statusMeta ? (
                <>
                  <span
                    className={[
                      "bob-status-bar__dot",
                      statusDirty ? "bob-status-bar__dot--dirty" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                  <span>{statusMeta}</span>
                </>
              ) : null}
            </span>
          </div>
          )}
        </main>

        {chatOpen ? (
          <aside className="bob-chat-region">
            <MarkdownLinkContext.Provider value={chatLinkContext}>
              <ChatPanel />
            </MarkdownLinkContext.Provider>
          </aside>
        ) : null}
      </div>

      </div>
      {settingsOpen ? <SettingsDialog onClose={() => closeSettings()} /> : null}
      {activeWorkspace && activeFileEntry ? (
        <VersionHistory
          workspaceId={activeWorkspace.id}
          filePath={activeFileEntry.relativePath}
          open={versionHistoryOpen}
          onClose={() => setVersionHistoryOpen(false)}
          onRestored={() => reloadActiveFile()}
        />
      ) : null}
    </>
  );
}
