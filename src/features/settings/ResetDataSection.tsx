import { Button, InlineNotification } from "@carbon/react";
import { useState } from "react";

import { resetAllData } from "../../lib/ipc/appClient";

/** Destructive "start over" in Settings → General: a two-step armed confirm
 *  (window.confirm is blocked by the Tauri dialog ACL). On success the app
 *  restarts itself into onboarding, so there's no resolved state to render. */
export function ResetDataSection() {
  const [armed, setArmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setError(null);
    setResetting(true);
    try {
      await resetAllData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reset failed");
      setResetting(false);
    }
  }

  return (
    <div className="settings-section">
      <h3>Reset all data</h3>
      <p className="settings-helper">
        Erase every workspace, conversation, setting, and saved API key, then restart Compose at
        first-run setup. Your note files on disk are not touched.
      </p>
      {armed ? (
        <>
          <p className="settings-helper">
            This permanently clears all Compose data on this computer and can't be undone.
          </p>
          <div className="settings-actions">
            <Button size="sm" kind="danger" disabled={resetting} onClick={() => void reset()}>
              {resetting ? "Resetting…" : "Erase and restart"}
            </Button>
            <Button size="sm" kind="ghost" disabled={resetting} onClick={() => setArmed(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" kind="danger--tertiary" onClick={() => setArmed(true)}>
          Reset all data
        </Button>
      )}
      {error ? (
        <InlineNotification
          hideCloseButton
          kind="error"
          lowContrast
          subtitle={error}
          title="Reset failed"
        />
      ) : null}
    </div>
  );
}
