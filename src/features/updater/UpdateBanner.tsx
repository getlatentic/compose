import { useUpdaterStore } from "../../app/store/updaterStore";

/**
 * A floating prompt shown when a newer version is ready to install — mounted at
 * the app root beside the toasts. Quiet by default: it only appears once a
 * silent check has found an update, then walks through download progress and the
 * relaunch. A failed check is surfaced as a toast, not here.
 */
export function UpdateBanner() {
  const status = useUpdaterStore((state) => state.status);
  const dismissed = useUpdaterStore((state) => state.dismissed);
  const downloadAndRestart = useUpdaterStore((state) => state.downloadAndRestart);
  const dismiss = useUpdaterStore((state) => state.dismiss);

  if (status.phase === "available" && !dismissed) {
    return (
      <div className="update-banner" role="status">
        <div className="update-banner__text">
          <strong>Update available</strong>
          <span>Version {status.update.version} is ready to install.</span>
        </div>
        <div className="update-banner__actions">
          <button type="button" className="update-banner__later" onClick={dismiss}>
            Later
          </button>
          <button
            type="button"
            className="update-banner__primary"
            onClick={() => void downloadAndRestart()}
          >
            Update &amp; restart
          </button>
        </div>
      </div>
    );
  }

  if (status.phase === "downloading") {
    const pct =
      status.total && status.total > 0
        ? Math.min(100, Math.round((status.downloaded / status.total) * 100))
        : null;
    return (
      <div className="update-banner" role="status" aria-live="polite">
        <div className="update-banner__text">
          <strong>Downloading update…</strong>
          <span>{pct != null ? `${pct}%` : "Starting…"}</span>
        </div>
        <div className="update-banner__progress" aria-hidden>
          <div
            className="update-banner__progress-fill"
            style={{ inlineSize: pct != null ? `${pct}%` : "15%" }}
          />
        </div>
      </div>
    );
  }

  if (status.phase === "ready") {
    return (
      <div className="update-banner" role="status">
        <div className="update-banner__text">
          <strong>Restarting…</strong>
          <span>Compose is restarting to finish the update.</span>
        </div>
      </div>
    );
  }

  return null;
}
