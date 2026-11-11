import { useCallback, useEffect, useState } from "react";
import { Button, Toggle } from "@carbon/react";

import {
  loginItemStatus,
  openLoginItemSettings,
  setLoginItem,
  type LoginItemService,
  type LoginItemStatus,
} from "../../lib/ipc/loginItemClient";

export interface LoginItemSettingProps {
  service: LoginItemService;
  /** The switch's element id. */
  id: string;
  label: string;
  /** What each state means for the user. */
  help: Record<LoginItemStatus, string>;
}

/**
 * Whether something of Compose's runs at login. macOS holds the switch, and the
 * user can flip it in System Settings, so it is read again when Compose comes
 * back to the front; nothing shows where it cannot run at login.
 */
export function LoginItemSetting({ service, id, label, help }: LoginItemSettingProps) {
  const [status, setStatus] = useState<LoginItemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    loginItemStatus(service).then(setStatus, () => setStatus(null));
  }, [service]);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const toggle = useCallback(
    async (checked: boolean) => {
      setError(null);
      try {
        setStatus(await setLoginItem(service, checked));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [service],
  );
  const onToggle = useCallback((checked: boolean) => void toggle(checked), [toggle]);
  const openSettings = useCallback(() => void openLoginItemSettings(), []);

  if (status === null) return null;

  return (
    <>
      <Toggle id={id} size="sm" labelText={label} labelA="Off" labelB="On" toggled={status === "on"} onToggle={onToggle} />
      <p className="settings-helper">{help[status]}</p>
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
