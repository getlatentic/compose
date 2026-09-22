import { useCallback, useEffect, useState } from "react";
import { Button } from "@carbon/react";

import { clearClipboardHistory, clipboardHistoryEnabled, setClipboardHistoryEnabled } from "../../lib/ipc/clipboardClient";

/** Whether Compose keeps what the user copies, and forgetting it. */
export function ClipboardHistorySetting() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [cleared, setCleared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    clipboardHistoryEnabled().then(
      (current) => {
        if (!cancelled) setEnabled(current);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
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

  const toggle = useCallback(
    () =>
      void attempt(async () => {
        setEnabled(await setClipboardHistoryEnabled(!enabled));
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

  if (enabled === null) return null;

  return (
    <>
      <p className="settings-helper">
        {enabled
          ? "Keeping what you copy in any app, on this Mac. What password managers copy is never kept."
          : "Not keeping what you copy. Turn it on to find past copies in the quick-note window."}
        {cleared ? " History cleared; pinned copies stay." : ""}
      </p>
      <div className="settings-actions">
        <Button size="sm" kind="tertiary" onClick={toggle}>
          {enabled ? "Stop keeping copies" : "Keep what I copy"}
        </Button>
        <Button size="sm" kind="ghost" onClick={clear}>
          Clear history
        </Button>
      </div>
      {error ? <p className="settings-helper settings-helper--error">{error}</p> : null}
    </>
  );
}
