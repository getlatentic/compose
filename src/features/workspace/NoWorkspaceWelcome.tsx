import { Button, InlineNotification } from "@carbon/react";
import { Folder } from "@carbon/react/icons";
import { useWorkspaceActions } from "./useWorkspaceActions";

/**
 * The first-run / no-workspace landing, shown in the shell's main area when
 * there is no active workspace. Replaces the deleted standalone dashboard: the
 * top bar still renders (so the Home menu works), and this card offers the two
 * ways to start — open a folder (+ sample in the browser preview) — plus the
 * recent-workspaces list when any exist. All open logic is shared with the
 * top-bar {@link WorkspaceMenu} via {@link useWorkspaceActions}.
 */
export function NoWorkspaceWelcome() {
  const { recent, openFolder, openSample, openWorkspace, removeRecent, busy, error, canOpenNativeFolder } =
    useWorkspaceActions();

  return (
    <div className="no-workspace">
      <div className="no-workspace__card">
        <h1 className="no-workspace__title">Welcome to Compose</h1>
        <p className="no-workspace__lead">
          Open a local folder of Markdown files and start writing with your AI assistant. Your
          files stay on your device.
        </p>
        <div className="no-workspace__cta">
          <Button
            kind="primary"
            size="lg"
            renderIcon={Folder}
            disabled={busy}
            onClick={() => void openFolder()}
          >
            Open a folder
          </Button>
          {!canOpenNativeFolder ? (
            <Button kind="tertiary" size="lg" disabled={busy} onClick={() => void openSample()}>
              Use sample workspace
            </Button>
          ) : null}
        </div>
        {error ? (
          <InlineNotification
            hideCloseButton
            kind="error"
            lowContrast
            title="Could not open folder"
            subtitle={error}
          />
        ) : null}

        {recent.length > 0 ? (
          <section className="no-workspace__recent">
            <h2 className="no-workspace__recent-heading">Recent workspaces</h2>
            <ul className="no-workspace__recent-list">
              {recent.slice(0, 5).map((record) => (
                <li key={record.id} className="no-workspace__recent-row">
                  <button
                    type="button"
                    className="no-workspace__recent-open"
                    onClick={() => openWorkspace(record.id)}
                  >
                    <span className="no-workspace__recent-icon" aria-hidden="true">
                      <Folder size={16} />
                    </span>
                    <span className="no-workspace__recent-meta">
                      <strong>{record.name}</strong>
                      <span>{record.path}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="no-workspace__recent-remove"
                    aria-label={`Remove ${record.name} from list`}
                    title="Remove from list"
                    onClick={() => void removeRecent(record.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
