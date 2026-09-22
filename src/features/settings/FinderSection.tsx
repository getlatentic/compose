import { useCallback, useEffect, useState } from "react";
import { Button } from "@carbon/react";

import { finderExtensionEnabled, openFinderExtensionSettings } from "../../lib/ipc/finderExtensionClient";

/**
 * Compose in the Finder, which the user turns on in System Settings. Read again
 * when Compose comes back to the front, which is when they have been there.
 */
export function FinderSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    finderExtensionEnabled().then(setEnabled, () => setEnabled(null));
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  const openSettings = useCallback(() => void openFinderExtensionSettings(), []);

  if (enabled === null) return null;

  return (
    <div className="settings-section">
      <h3>Finder</h3>
      <p className="settings-helper">
        {enabled
          ? "In a workspace's folders, right-click a note to open it in Compose, or a folder to start a new note there. The Compose button can go in any Finder window's toolbar."
          : "Turn on Compose under Finder extensions to open notes and start new ones from the Finder."}
      </p>
      <div className="settings-actions">
        <Button size="sm" kind="tertiary" onClick={openSettings}>
          {enabled ? "Finder extension settings" : "Turn on in System Settings"}
        </Button>
      </div>
    </div>
  );
}
