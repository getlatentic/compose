import { useMemo, useState } from "react";
import {
  ActionableNotification,
  Button,
  InlineNotification,
  Link,
  OverflowMenu,
  OverflowMenuItem,
  Tile,
} from "@carbon/react";
import {
  ChatBot,
  Document,
  Folder,
  HelpDesk,
  Settings,
  Time,
  Asterisk,
} from "@carbon/react/icons";
import {
  addWorkspace,
  canUseNativeFolderPicker,
  removeWorkspace,
  selectWorkspaceFolder,
  type WorkspaceRecord,
} from "../../lib/ipc/workspaceClient";
import {
  applyImportedFolder,
  importFolderFromPicker,
  type ImportedFile,
} from "../../lib/workspace/folderImport";
import { type BobInstallStatus } from "../../lib/ipc/settingsClient";
import { useWorkspaceStore } from "../../app/workspaceStore";

const browserPreviewWorkspacePath = "/Users/dev/workspace/bob4everyone";

type DashboardNav = "home" | "recent" | "settings";

interface DashboardScreenProps {
  onOpenSettings: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
}

export function DashboardScreen({
  onOpenSettings,
  onOpenWorkspace,
}: DashboardScreenProps) {
  const bobAuthStatus = useWorkspaceStore((state) => state.bobAuthStatus);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrateWorkspaces);
  const removeStoreWorkspace = useWorkspaceStore((state) => state.removeWorkspace);

  const [activeNav, setActiveNav] = useState<DashboardNav>("home");
  // Read install status from the store — it's populated by
  // AppShell's single boot-time probe. Previously this component
  // had its own checkBobInstall() useEffect, which (with React
  // StrictMode + dashboard remounts on viewMode flips) fired the
  // IPC repeatedly. The store is the single source of truth.
  const installStatus: BobInstallStatus | null = useWorkspaceStore(
    (state) => state.bobInstallStatus,
  );
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const recent = useMemo<WorkspaceRecord[]>(() => {
    return workspaces
      .map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        path: workspace.path,
        lastOpenedAt: workspace.lastOpenedAt,
      }))
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
  }, [workspaces]);

  async function handleOpenFolder() {
    setOpenError(null);
    if (canUseNativeFolderPicker()) {
      const path = await selectWorkspaceFolder();
      if (!path) return;
      await openPath(path);
      return;
    }
    // Browser: import a real folder into the persisted virtual workspace.
    const imported = await importFolderFromPicker();
    if (!imported) return;
    if (imported.files.length === 0) {
      setOpenError("No Markdown files were found in that folder.");
      return;
    }
    await openPath(`/${imported.folderName}`, imported.files);
  }

  async function handleSample() {
    await openPath(browserPreviewWorkspacePath);
  }

  async function openPath(path: string, importedFiles?: ImportedFile[]) {
    setAddingWorkspace(true);
    try {
      const list = await addWorkspace(path);
      if (importedFiles && list.activeWorkspaceId) {
        // Populate the virtual workspace before opening it, so the scan
        // that follows reads the imported files (not the demo seed).
        await applyImportedFolder(list.activeWorkspaceId, importedFiles);
      }
      hydrateWorkspaces(list);
      const newWorkspace =
        list.workspaces.find((item) => item.id === list.activeWorkspaceId) ??
        list.workspaces[list.workspaces.length - 1];
      if (newWorkspace) {
        onOpenWorkspace(newWorkspace.id);
      }
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Could not open folder");
    } finally {
      setAddingWorkspace(false);
    }
  }

  async function handleRemove(workspaceId: string) {
    try {
      const list = await removeWorkspace(workspaceId);
      hydrateWorkspaces(list);
    } catch {
      removeStoreWorkspace(workspaceId);
    }
  }

  return (
    <div className="bob-dashboard">
      <aside className="bob-dashboard__rail">
        <div className="bob-dashboard__brand">
          <span className="bob-dashboard__brand-mark" aria-hidden="true">
            <ChatBot size={16} />
          </span>
          <div className="bob-dashboard__brand-text">
            <strong>Compose</strong>
            <span>AI for everyone</span>
          </div>
        </div>

        <nav className="bob-dashboard__nav" aria-label="Dashboard">
          <RailNavItem
            active={activeNav === "home"}
            icon={<Asterisk size={16} />}
            label="Home"
            onClick={() => setActiveNav("home")}
          />
          <RailNavItem
            active={activeNav === "recent"}
            icon={<Time size={16} />}
            label="Recent"
            onClick={() => setActiveNav("recent")}
          />
          <RailNavItem
            active={activeNav === "settings"}
            icon={<Settings size={16} />}
            label="Settings"
            onClick={() => {
              setActiveNav("settings");
              onOpenSettings();
            }}
          />
        </nav>

        <div className="bob-dashboard__rail-footer">
          <RailStatusLine status={installStatus} />
          <button type="button" className="bob-dashboard__rail-help">
            <HelpDesk size={16} />
            <span>Help & feedback</span>
          </button>
        </div>
      </aside>

      <main className="bob-dashboard__main">
        <div className="bob-dashboard__content">
          <header className="bob-dashboard__hero">
            <h1>Welcome to your workspace</h1>
            <p>Open a local folder and start writing with Bob. Your files stay on your device.</p>
            <div className="bob-dashboard__cta-row">
              <Button
                kind="primary"
                onClick={() => void handleOpenFolder()}
                renderIcon={Folder}
                size="lg"
                disabled={addingWorkspace}
              >
                Open a folder
              </Button>
              {!canUseNativeFolderPicker() ? (
                <Button
                  kind="tertiary"
                  onClick={() => void handleSample()}
                  size="lg"
                  disabled={addingWorkspace}
                >
                  Use sample workspace
                </Button>
              ) : null}
            </div>
            {openError ? (
              <InlineNotification
                hideCloseButton
                kind="error"
                lowContrast
                subtitle={openError}
                title="Could not open folder"
              />
            ) : null}
          </header>

          {!bobAuthStatus.configured ? (
            <ActionableNotification
              kind="info"
              lowContrast
              title="API key not connected."
              subtitle="Connect your key to enable Bob's chat features."
              hideCloseButton
              actionButtonLabel="Connect key"
              onActionButtonClick={onOpenSettings}
            />
          ) : null}

          <section className="bob-dashboard__section">
            <div className="bob-dashboard__section-header">
              <h2>Recent workspaces</h2>
              {recent.length > 3 ? (
                <Link href="#" onClick={(event) => event.preventDefault()}>
                  View all
                </Link>
              ) : null}
            </div>
            {recent.length === 0 ? (
              <Tile className="bob-dashboard__empty">
                <Document size={20} />
                <p>No workspaces yet. Open a folder to get started.</p>
              </Tile>
            ) : (
              <ul className="bob-dashboard__recent">
                {recent.slice(0, 5).map((record) => (
                  <li key={record.id} className="bob-dashboard__recent-row">
                    <button
                      type="button"
                      className="bob-dashboard__recent-button"
                      onClick={() => onOpenWorkspace(record.id)}
                    >
                      <span className="bob-dashboard__recent-icon" aria-hidden="true">
                        <Folder size={16} />
                      </span>
                      <span className="bob-dashboard__recent-meta">
                        <strong>{record.name}</strong>
                        <span>{record.path}</span>
                      </span>
                      <span className="bob-dashboard__recent-time">
                        {formatRelative(record.lastOpenedAt)}
                      </span>
                    </button>
                    <OverflowMenu
                      aria-label={`Workspace actions for ${record.name}`}
                      size="sm"
                      flipped
                    >
                      <OverflowMenuItem
                        itemText="Open"
                        onClick={() => onOpenWorkspace(record.id)}
                      />
                      <OverflowMenuItem
                        hasDivider
                        isDelete
                        itemText="Remove from list"
                        onClick={() => void handleRemove(record.id)}
                      />
                    </OverflowMenu>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="bob-dashboard__aside">
          <Tile className="bob-dashboard__aside-card">
            <h3>Getting started</h3>
            <GuideItem
              number="1"
              title="Open a folder"
              body="Choose any local folder with Markdown files."
            />
            <GuideItem
              number="2"
              title="Start writing"
              body="Bob reads and writes Markdown files alongside you."
            />
            <GuideItem
              number="3"
              title="Stay in control"
              body="No uploads, no sync. Your data stays local."
            />
          </Tile>
        </aside>
      </main>
    </div>
  );
}

function RailNavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={["bob-dashboard__nav-item", active ? "bob-dashboard__nav-item--active" : ""]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function RailStatusLine({ status }: { status: BobInstallStatus | null }) {
  const label = !status
    ? "Checking Bob CLI"
    : status.requiresDesktopRuntime
      ? "Desktop app required"
    : status.installed
      ? `Bob CLI ${status.version && /^\d/.test(status.version) ? `v${status.version}` : status.version ?? "detected"}`
      : "Bob CLI not found";
  const tone = !status ? "neutral" : status.installed ? "ok" : "warn";
  return (
    <div
      className={`bob-dashboard__rail-status bob-dashboard__rail-status--${tone}`}
      title={status?.path ?? status?.errorMessage}
    >
      <span className="bob-dashboard__rail-status-dot" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function GuideItem({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <div className="bob-dashboard__guide-item">
      <span className="bob-dashboard__guide-num" aria-hidden="true">
        {number}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}

function formatRelative(ms?: number) {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "Just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  const days = Math.floor(diff / day);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}
