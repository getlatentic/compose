import { useCallback, useEffect, useState } from "react";
import { Button } from "@carbon/react";
import { CheckmarkFilled } from "@carbon/react/icons";

import {
  markdownHandlerStatus,
  setDefaultMarkdownHandler,
  type MarkdownHandlerStatus,
} from "../../lib/ipc/defaultHandlerClient";

/**
 * "Default app for Markdown" (#113): shows which app opens `.md` files today
 * and offers to make it Compose, via LaunchServices. Setting can fail (e.g. a
 * dev build LaunchServices has never seen) — the error keeps the manual
 * Finder path visible so the user is never stuck.
 */
export function DefaultMarkdownAppSection() {
  const [status, setStatus] = useState<MarkdownHandlerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    markdownHandlerStatus()
      .then((current) => {
        if (!cancelled) setStatus(current);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const makeDefault = useCallback(() => {
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        setStatus(await setDefaultMarkdownHandler());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  // Status unavailable (off-macOS, browser preview, or a probe failure) —
  // there is nothing actionable to show.
  if (!status) {
    return null;
  }

  return (
    <div className="settings-section">
      <h3>Default app for Markdown</h3>
      {status.isDefault ? (
        <p className="settings-helper settings-helper--ok">
          <CheckmarkFilled size={16} aria-hidden /> Compose opens Markdown files by default —
          double-clicking a .md file in Finder lands here.
        </p>
      ) : (
        <>
          <p className="settings-helper">
            {status.currentHandler
              ? `Markdown files currently open with ${status.currentHandler}.`
              : "No default app is set for Markdown files."}{" "}
            Make Compose the default so double-clicking a .md file in Finder opens it here.
          </p>
          <div className="settings-actions">
            <Button size="sm" kind="tertiary" disabled={busy} onClick={makeDefault}>
              Make Compose the default
            </Button>
          </div>
        </>
      )}
      {error ? (
        <p className="settings-helper settings-helper--error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
