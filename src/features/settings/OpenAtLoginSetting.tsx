import { useCallback, useEffect, useState } from "react";
import { Button, Toggle } from "@carbon/react";

import { loginItemStatus, openLoginItemSettings, setLoginItem, type LoginItemStatus } from "../../lib/ipc/loginItemClient";

const HELP: Record<LoginItemStatus, string> = {
  on: "Compose opens without a window when you log in, so the quick note is ready. Click its Dock icon for the main window.",
  off: "The quick note works while Compose is open, even with its window closed. Turn this on to have it from the moment you log in.",
  needsApproval: "Compose is switched off under Login Items in System Settings, so it does not open at login.",
};

/**
 * Whether macOS opens Compose at login, which keeps the quick note's shortcuts
 * working from then on. macOS holds the switch, and the user can flip it in
 * System Settings, so it is read again when Compose comes back to the front.
 */
export function OpenAtLoginSetting() {
  const [status, setStatus] = useState<LoginItemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    loginItemStatus().then(setStatus, () => setStatus(null));
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const toggle = useCallback(async (checked: boolean) => {
    setError(null);
    try {
      setStatus(await setLoginItem(checked));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);
  const onToggle = useCallback((checked: boolean) => void toggle(checked), [toggle]);
  const openSettings = useCallback(() => void openLoginItemSettings(), []);

  if (status === null) return null;

  return (
    <>
      <Toggle
        id="open-at-login"
        size="sm"
        labelText="Open Compose at login"
        labelA="Off"
        labelB="On"
        toggled={status === "on"}
        onToggle={onToggle}
      />
      <p className="settings-helper">{HELP[status]}</p>
      {status === "needsApproval" ? (
        <div className="settings-actions">
          <Button size="sm" kind="tertiary" onClick={openSettings}>
            Open Login Items
          </Button>
        </div>
      ) : null}
      {error ? <p className="settings-helper settings-helper--error">{error}</p> : null}
    </>
  );
}
