import { useCallback, useEffect, useState } from "react";
import { Button } from "@carbon/react";

import { captureShortcut, setCaptureShortcut, type CaptureShortcut } from "../../lib/ipc/captureClient";
import { shortcutFromKeyPress, shortcutLabel } from "./captureShortcut";

/**
 * "Quick note": the global shortcut that opens a small window over any app, to
 * jot an idea into the open workspace. Changing it records the next shortcut
 * pressed; one the system refuses leaves the old one on.
 */
export function QuickCaptureSection() {
  const [shortcut, setShortcut] = useState<CaptureShortcut | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    captureShortcut().then(
      (current) => {
        if (!cancelled) setShortcut(current);
      },
      () => {
        if (!cancelled) setShortcut(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = useCallback(async (next: string | null) => {
    setBusy(true);
    setError(null);
    try {
      setShortcut(await setCaptureShortcut(next));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(
    function recordNextShortcut() {
      if (!recording) return;
      const onKeyDown = (event: KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.code === "Escape") {
          setRecording(false);
          return;
        }
        const pressed = shortcutFromKeyPress(event);
        if (pressed) {
          setRecording(false);
          void choose(pressed);
        }
      };
      window.addEventListener("keydown", onKeyDown, true);
      return () => window.removeEventListener("keydown", onKeyDown, true);
    },
    [recording, choose],
  );

  const startRecording = useCallback(() => {
    setError(null);
    setRecording(true);
  }, []);
  const stopRecording = useCallback(() => setRecording(false), []);
  const turnOff = useCallback(() => void choose(null), [choose]);
  const restoreDefault = useCallback(() => {
    if (shortcut) void choose(shortcut.default);
  }, [choose, shortcut]);

  // Unavailable in the browser preview, where there is no system to register with.
  if (!shortcut) return null;

  const current = shortcut.current;
  return (
    <div className="settings-section">
      <h3>Quick note</h3>
      <p className="settings-helper">
        {recording
          ? "Press the new shortcut — hold ⌘, ⌃ or ⌥ with a key. Esc cancels."
          : current
            ? `Press ${shortcutLabel(current)} in any app to jot an idea into the open workspace; ⌘↩ saves it.`
            : "Off. Turn it on to jot ideas from any app."}
      </p>
      <div className="settings-actions">
        {recording ? (
          <Button size="sm" kind="ghost" onClick={stopRecording}>
            Cancel
          </Button>
        ) : (
          <>
            <Button size="sm" kind="tertiary" disabled={busy} onClick={startRecording}>
              {current ? "Change shortcut" : "Turn on"}
            </Button>
            {current && current !== shortcut.default ? (
              <Button size="sm" kind="ghost" disabled={busy} onClick={restoreDefault}>
                Use {shortcutLabel(shortcut.default)}
              </Button>
            ) : null}
            {current ? (
              <Button size="sm" kind="ghost" disabled={busy} onClick={turnOff}>
                Turn off
              </Button>
            ) : null}
          </>
        )}
      </div>
      {error ? <p className="settings-helper settings-helper--error">{error}</p> : null}
    </div>
  );
}
