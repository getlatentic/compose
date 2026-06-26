import { useEffect, useState } from "react";
import { Button, Link } from "@carbon/react";
import { Launch } from "@carbon/react/icons";

import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { useUpdaterStore } from "../../app/store/updaterStore";

/** The "About" pane: identity + the manual update check. The version is read at
 *  runtime (it must match what the updater compares against) rather than
 *  hardcoded. The local-only diagnostics (error log, reset all data) live in
 *  General, so this stays a slim identity card. */
export function AboutSettings() {
  const version = useAppVersion();
  const checking = useUpdaterStore((state) => state.status.phase === "checking");
  const check = useUpdaterStore((state) => state.check);

  return (
    <div className="settings-section">
      <h3>Compose</h3>
      {version ? <p className="settings-helper">Version {version}</p> : null}
      <p className="settings-helper">
        A local-first AI writing workspace — your notes stay on your computer. AI for everyone.
      </p>
      {isTauriRuntime() ? (
        <div className="settings-actions">
          <Button
            size="sm"
            kind="tertiary"
            disabled={checking}
            onClick={() => void check({ manual: true })}
          >
            {checking ? "Checking…" : "Check for updates"}
          </Button>
        </div>
      ) : null}
      <div className="about-links">
        <Link renderIcon={Launch}>Release notes</Link>
        <Link renderIcon={Launch}>Licenses</Link>
        <Link renderIcon={Launch}>Privacy</Link>
      </div>
    </div>
  );
}

/** The running app version from Tauri, or null in the browser preview. */
function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let active = true;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((value) => {
        if (active) setVersion(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return version;
}
