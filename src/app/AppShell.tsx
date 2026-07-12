import { lazy, Suspense, type CSSProperties } from "react";
import { WorkspaceSidebar } from "../features/workspace/WorkspaceSidebar";
import { NoWorkspaceWelcome } from "../features/workspace/NoWorkspaceWelcome";
import { WorkspaceSearchPopover } from "../features/workspace/WorkspaceSearchPopover";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { ChatRegion } from "../features/chat/ChatRegion";
import { useWorkspaceStore } from "./workspaceStore";
import { useUiStore } from "./store/uiStore";

// The editor (CodeMirror + KaTeX + the markdown decoration stack) is by far the
// heaviest code and isn't needed to paint the shell. Lazy-load it so the sidebar
// + chat render immediately on launch; the editor chunk fetches when a document
// is open. The chat markdown pipeline has no math, so KaTeX rides along here —
// off the boot path entirely.
const EditorRegion = lazy(() =>
  import("../features/editor/EditorRegion").then((module) => ({
    default: module.EditorRegion,
  })),
);

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
  // workspace object changes (e.g. on every edit). A focused external file
  // (#113) also earns the shell — with zero workspaces, an OS-opened file must
  // still get an editor, not vanish behind the welcome card.
  const hasActiveWorkspace = useWorkspaceStore(
    (state) =>
      state.workspaces.some((workspace) => workspace.id === state.activeWorkspaceId) ||
      state.focusedArea === "loose",
  );
  const editorOpen = useUiStore((state) => state.editorOpen);
  const chatOpen = useUiStore((state) => state.chatOpen);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  // Focus mode (#126) is a LAYOUT OVERRIDE: the pane flags above stay
  // untouched while it's on, so leaving focus restores the exact previous
  // layout — including across restarts (the flag persists, the panes don't
  // need to).
  const focusMode = useUiStore((state) => state.focusMode);
  // Committed pane widths (#119). Live dragging writes the CSS var on the
  // element directly; these only change on release, so the shell re-renders
  // once per drag, not per pixel.
  const sidebarWidthPx = useUiStore((state) => state.sidebarWidthPx);
  const chatWidthPx = useUiStore((state) => state.chatWidthPx);
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
            className={
              focusMode
                ? "workspace workspace--focus"
                : [
                    "workspace",
                    editorOpen ? "workspace--editor-open" : "",
                    chatOpen ? "workspace--chat-open" : "",
                    sidebarCollapsed ? "workspace--sidebar-collapsed" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")
            }
            style={
              {
                ...(sidebarWidthPx ? { "--sidebar-w": `${sidebarWidthPx}px` } : {}),
                ...(chatWidthPx ? { "--chat-w": `${chatWidthPx}px` } : {}),
              } as CSSProperties
            }
          >
            {focusMode ? null : <WorkspaceSidebar />}
            {editorOpen || focusMode ? (
              <Suspense fallback={<div className="editor-region" aria-busy="true" />}>
                <EditorRegion />
              </Suspense>
            ) : null}
            {chatOpen && !focusMode ? <ChatRegion /> : null}
          </div>
        )}
      </div>
      <WorkspaceSearchPopover />
      {settingsOpen ? <SettingsDialog onClose={() => closeSettings()} /> : null}
    </>
  );
}
