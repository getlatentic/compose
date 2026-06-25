import { useCallback, useEffect, useMemo } from "react";
import { PaneTabs, type EditorTab } from "./PaneTabs";
import { ActiveDocument } from "./ActiveDocument";
import { DocumentStatusBar } from "./DocumentStatusBar";
import { WELCOME_NOTE_CONTENT, WELCOME_NOTE_NAME } from "./welcomeNote";
import { WorkspaceWelcome } from "../workspace/WorkspaceWelcome";
import { MAC_TRAFFIC_LIGHTS_INSET } from "../workspace/WorkspaceSidebar";
import { useWorkspaceActions } from "../workspace/useWorkspaceActions";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { useUiStore } from "../../app/store/uiStore";
import { useHarnessStore } from "../../app/store/harnessStore";
import { selectActiveWorkspace } from "../../app/store/activeWorkspace";
import { isActiveFilePresent, resolveOpenTabs } from "../../app/workspaceModel";
import { markBoot } from "../../lib/perf";

/**
 * The editor region — a LAYOUT SHELL: the tab strip, the editor body (which
 * file state to show), and the status bar. It subscribes only to STRUCTURAL
 * facts (which file is open, whether it exists, how many files the workspace
 * has) — never the active file's content — so a keystroke re-renders the leaves
 * that own content ({@link ActiveDocument}, {@link DocumentStatusBar}) and not
 * this shell, the tabs, the sidebar, or chat. Rendered by AppShell only when
 * `editorOpen`.
 */
/** The starter the empty-state "Ask the assistant" sends: a first-note demo, so
 * the button drafts a note rather than opening an empty chat. */
const FIRST_NOTE_PROMPT =
  "Create my first note — a short Hello World that shows what Compose can do.";

export function EditorRegion() {
  useEffect(() => {
    markBoot("editor");
  }, []);
  const activeFilePath = useWorkspaceStore(
    (state) => selectActiveWorkspace(state)?.activeFilePath ?? "",
  );
  // Whether the active file should render its document (vs still loading, vs no
  // file open). True when it's an open tab / has a loaded buffer / is in the
  // scan — so a transient scan miss on a large vault can't blank an open
  // document. A boolean — stable across a save's mtime/size churn on the entry.
  const activeFileExists = useWorkspaceStore((state) => {
    const workspace = selectActiveWorkspace(state);
    return workspace ? isActiveFilePresent(workspace) : false;
  });
  const fileCount = useWorkspaceStore((state) => selectActiveWorkspace(state)?.files.length ?? 0);
  // The first scan hasn't landed yet (idle/loading) — render blank, not the
  // empty-folder card, so a fresh open doesn't flash "empty" before its files
  // (and the auto-opened note) arrive. The scan runs concurrently with the file
  // read, so this is near-instant — a loader would only flash.
  const scanPending = useWorkspaceStore((state) => {
    const scanState = selectActiveWorkspace(state)?.scanState;
    return scanState === "idle" || scanState === "loading";
  });
  // Open paths as a string KEY — stable across edits/saves so the memoised
  // PaneTabs re-renders only when a tab opens/closes (dirty is read per-tab by
  // TabDirtyDot).
  const openTabsKey = useWorkspaceStore(
    (state) => selectActiveWorkspace(state)?.openFilePaths.join("\n") ?? "",
  );

  const closeFileTab = useWorkspaceStore((state) => state.closeFileTab);
  const createNote = useWorkspaceStore((state) => state.createNote);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const setChatPrompt = useWorkspaceStore((state) => state.setChatPrompt);
  const sendChatPrompt = useWorkspaceStore((state) => state.sendChatPrompt);
  const chatOpen = useUiStore((state) => state.chatOpen);
  const toggleChat = useUiStore((state) => state.toggleChat);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const requestComposerFocus = useUiStore((state) => state.requestComposerFocus);
  const { openFolder, canOpenNativeFolder } = useWorkspaceActions();

  const openTabs = useMemo<EditorTab[]>(() => {
    const ws = useWorkspaceStore.getState().activeWorkspace();
    if (!ws) return [];
    // One tab per open path — a path whose file is transiently missing from the
    // scan keeps a synthesized entry, so a partial/racing scan never drops a
    // tab (resolveOpenTabs). Only closing the tab removes it.
    return resolveOpenTabs(ws).map((entry) => ({ entry }));
    // openTabsKey captures the open paths; getState reads the live entries when
    // those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTabsKey]);

  // Stable so the memoised PaneTabs isn't re-rendered by a fresh callback
  // identity on every render.
  const handleSelectTab = useCallback((path: string) => void selectFile(path), [selectFile]);
  const handleCloseTab = useCallback(
    (filePath: string) => {
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
    },
    [closeFileTab],
  );

  // Empty-state "Ask the assistant": open the chat, pre-fill a first-note starter,
  // and SEND it if an agent is ready — so the click drafts a note instead of just
  // opening an empty chat. Not ready → leave it staged to send once an agent is set up.
  const askAssistantToStart = useCallback(() => {
    if (!chatOpen) toggleChat();
    setChatPrompt(FIRST_NOTE_PROMPT);
    const { selectedHarnessId, selectedHarnessReadiness } = useHarnessStore.getState();
    const ready =
      Boolean(selectedHarnessId) && (!selectedHarnessReadiness || selectedHarnessReadiness.ready);
    if (ready) {
      void sendChatPrompt();
    } else {
      requestComposerFocus();
    }
  }, [chatOpen, toggleChat, setChatPrompt, sendChatPrompt, requestComposerFocus]);

  return (
    <main id="main-content" className="editor-region">
      <PaneTabs
        files={openTabs}
        activeFilePath={activeFilePath}
        onSelectFile={handleSelectTab}
        onCloseFile={handleCloseTab}
        leadingInsetPx={sidebarCollapsed ? MAC_TRAFFIC_LIGHTS_INSET : 0}
        onShowSidebar={sidebarCollapsed ? toggleSidebar : undefined}
      />
      {activeFileExists ? (
        <ActiveDocument />
      ) : scanPending ? (
        <div className="editor-body" />
      ) : (
        <div className="editor-body">
          <WorkspaceWelcome
            title={fileCount === 0 ? "Start your first document" : "No note open"}
            lead={
              fileCount === 0
                ? "Create a note, open an existing folder, or ask the assistant to help you begin."
                : "Pick a note from the sidebar, or start a new one."
            }
            newNoteLabel={fileCount === 0 ? "Create a note" : "New note"}
            onOpenFolder={
              fileCount === 0 && canOpenNativeFolder ? () => void openFolder() : undefined
            }
            onNewNote={
              fileCount === 0
                ? () =>
                    void createNote({
                      relativePath: WELCOME_NOTE_NAME,
                      content: WELCOME_NOTE_CONTENT,
                    })
                : () => void createNote()
            }
            onAskAssistant={
              fileCount === 0
                ? askAssistantToStart
                : () => {
                    if (!chatOpen) toggleChat();
                    requestComposerFocus();
                  }
            }
          />
        </div>
      )}
      {activeFileExists ? <DocumentStatusBar /> : null}
    </main>
  );
}
