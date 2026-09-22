import { useCallback, useEffect, useState } from "react";
import { Button } from "@carbon/react";

import {
  clearClipboardHistory,
  clipboardHistoryStatus,
  onClipboardHistoryChanged,
  openClipboardPrivacySettings,
  setClipboardHistoryEnabled,
  type ClipboardHistoryStatus,
} from "../../lib/ipc/clipboardClient";

const BLOCKED = {
  asks: "macOS asks before Compose reads what other apps copy, so new copies are not kept.",
  denied: "macOS stops Compose from reading what other apps copy, so new copies are not kept.",
} as const;

/** Whether Compose keeps what the user copies, and forgetting it. */
export function ClipboardHistorySetting() {
  const [status, setStatus] = useState<ClipboardHistoryStatus | null>(null);
  const [cleared, setCleared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const load = () =>
      clipboardHistoryStatus().then(
        (current) => {
          if (!cancelled) setStatus(current);
        },
        () => undefined,
      );
    void load();
    onClipboardHistoryChanged(() => void load()).then(
      (stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const attempt = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const enabled = status?.enabled ?? false;
  const toggle = useCallback(
    () =>
      void attempt(async () => {
        await setClipboardHistoryEnabled(!enabled);
        setStatus(await clipboardHistoryStatus());
        setCleared(false);
      }),
    [attempt, enabled],
  );
  const clear = useCallback(
    () =>
      void attempt(async () => {
        await clearClipboardHistory();
        setCleared(true);
      }),
    [attempt],
  );
  const openPrivacySettings = useCallback(() => void attempt(openClipboardPrivacySettings), [attempt]);

  if (!status) return null;
  const blocked = status.enabled && status.access !== "allowed" ? BLOCKED[status.access] : null;

  return (
    <>
      <p className="settings-helper">
        {status.enabled
          ? "Keeping what you copy in any app, on this Mac. What password managers copy is never kept."
          : "Not keeping what you copy. Turn it on to find past copies in the quick-note window."}
        {cleared ? " History cleared; pinned copies stay." : ""}
      </p>
      {blocked ? (
        <p className="settings-helper settings-helper--error">
          {blocked} Set Compose to Allow under Paste from Other Apps.
        </p>
      ) : null}
      <div className="settings-actions">
        <Button size="sm" kind="tertiary" onClick={toggle}>
          {status.enabled ? "Stop keeping copies" : "Keep what I copy"}
        </Button>
        {blocked ? (
          <Button size="sm" kind="tertiary" onClick={openPrivacySettings}>
            Open Privacy &amp; Security
          </Button>
        ) : null}
        <Button size="sm" kind="ghost" onClick={clear}>
          Clear history
        </Button>
      </div>
      {error ? <p className="settings-helper settings-helper--error">{error}</p> : null}
    </>
  );
}
