import { useCallback, useEffect, useState } from "react";
import { Toggle } from "@carbon/react";

import { setSpotlightEnabled, spotlightEnabled } from "../../lib/ipc/spotlightClient";

/** Whether a Spotlight search on this Mac finds notes and opens them in Compose. */
export function SpotlightSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    spotlightEnabled().then(
      (current) => {
        if (!cancelled) setEnabled(current);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(async (checked: boolean) => {
    setError(null);
    try {
      setEnabled(await setSpotlightEnabled(checked));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);
  const onToggle = useCallback((checked: boolean) => void toggle(checked), [toggle]);

  if (enabled === null) return null;

  return (
    <div className="settings-section">
      <h3>Spotlight</h3>
      <Toggle
        id="spotlight-enabled"
        size="sm"
        labelText="Show notes in Spotlight"
        labelA="Off"
        labelB="On"
        toggled={enabled}
        onToggle={onToggle}
      />
      <p className="settings-helper">
        {enabled
          ? "Spotlight finds your notes by their titles and words, and opens them in Compose. The index stays on this Mac."
          : "Spotlight does not show your notes. Turning this on adds every workspace's notes to it."}
      </p>
      {error ? <p className="settings-helper settings-helper--error">{error}</p> : null}
    </div>
  );
}
