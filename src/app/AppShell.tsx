import { WorkspaceSidebar } from "../features/workspace/WorkspaceSidebar";
import { NoWorkspaceWelcome } from "../features/workspace/NoWorkspaceWelcome";
import { WorkspaceSearchPopover } from "../features/workspace/WorkspaceSearchPopover";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { EditorRegion } from "../features/editor/EditorRegion";
import { ChatRegion } from "../features/chat/ChatRegion";
import { useWorkspaceStore } from "./workspaceStore";
import { useUiStore } from "./store/uiStore";

/**
 * The layout shell for the editor / chat / sidebar — the "main app" chrome.
 * Deliberately subscribes to only **narrow** state: the pane-visibility UI
 * flags and a boolean "is a workspace active". Both are primitives, so the
 * shell re-renders on pane toggles / workspace switches — never on a keystroke.
 * The document-heavy regions (EditorRegion, ChatRegion, WorkspaceSidebar) each
 * self-subscribe, so content churn stays contained to the editor region.
 */
export function AppShell() {
  // Boolean selector: reads `workspaces` but returns a primitive, so it only
  // re-renders the shell when the active-workspace existence flips, not when a
  // workspace object changes (e.g. on every edit).
  const hasActiveWorkspace = useWorkspaceStore((state) =>
    state.workspaces.some((workspace) => workspace.id === state.activeWorkspaceId),
  );
  const editorOpen = useUiStore((state) => state.editorOpen);
  const chatOpen = useUiStore((state) => state.chatOpen);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const closeSettings = useUiStore((state) => state.closeSettings);

  return (
    <>
      <div className="app-shell">
        {/* The global Carbon Header is gone in this redesign: app-name ownership
          * moves to the macOS menu bar, the workspace switcher + New + Settings
          * live in the sidebar, and the chat-toggle lives in the editor toolbar.
          * `titleBarStyle: Overlay` overlays the traffic lights onto the sidebar
          * titlebar row, so there's nothing left for a top header to host. */}
        {!hasActiveWorkspace ? (
          <NoWorkspaceWelcome />
        ) : (
          <div
            className={[
              "workspace",
              editorOpen ? "workspace--editor-open" : "",
              chatOpen ? "workspace--chat-open" : "",
              sidebarCollapsed ? "workspace--sidebar-collapsed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <WorkspaceSidebar />
            {editorOpen ? <EditorRegion /> : null}
            {chatOpen ? <ChatRegion /> : null}
          </div>
        )}
      </div>
      <WorkspaceSearchPopover />
      {settingsOpen ? <SettingsDialog onClose={() => closeSettings()} /> : null}
    </>
  );
}
