import { useCallback, useEffect, useState } from "react";
import { Button } from "@carbon/react";

import type { CaptureShortcut } from "../../lib/ipc/captureClient";
import { shortcutFromKeyPress, shortcutLabel } from "./captureShortcut";

export interface ShortcutSettingProps {
  shortcut: CaptureShortcut;
  /** What pressing the shortcut does, given its label: "Press ⌃⌥N in any app to …". */
  describe(label: string): string;
  /** Said while the shortcut is off. */
  offText: string;
  /** Registers `next`, or turns the shortcut off with `null`; rejects to keep the old one. */
  choose(next: string | null): Promise<void>;
}

/**
 * A global shortcut the user can change: the next shortcut pressed replaces it.
 * One the system refuses leaves the old one on, and says why.
 */
export function ShortcutSetting({ shortcut, describe, offText, choose }: ShortcutSettingProps) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback(
    async (next: string | null) => {
      setBusy(true);
      setError(null);
      try {
        await choose(next);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(false);
      }
    },
    [choose],
  );

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
          void apply(pressed);
        }
      };
      window.addEventListener("keydown", onKeyDown, true);
      return () => window.removeEventListener("keydown", onKeyDown, true);
    },
    [recording, apply],
  );

  const startRecording = useCallback(() => {
    setError(null);
    setRecording(true);
  }, []);
  const stopRecording = useCallback(() => setRecording(false), []);
  const turnOff = useCallback(() => void apply(null), [apply]);
  const restoreDefault = useCallback(() => void apply(shortcut.default), [apply, shortcut.default]);

  const current = shortcut.current;
  return (
    <>
      <p className="settings-helper">
        {recording
          ? "Press the new shortcut — hold ⌘, ⌃ or ⌥ with a key. Esc cancels."
          : current
            ? describe(shortcutLabel(current))
            : offText}
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
    </>
  );
}
