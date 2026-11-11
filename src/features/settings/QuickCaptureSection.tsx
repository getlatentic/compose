import { useCallback, useEffect, useState } from "react";

import { captureShortcuts, setCaptureShortcut, type CaptureShortcuts } from "../../lib/ipc/captureClient";
import { ClipboardHistorySetting } from "./ClipboardHistorySetting";
import { LoginItemSetting } from "./LoginItemSetting";
import { ShortcutSetting } from "./ShortcutSetting";

const describeNotes = (label: string) => `Press ${label} in any app to jot an idea; ⌘↩ saves it into the open workspace.`;
const describeClipboard = (label: string) => `Press ${label} in any app to find what you copied, paste it again, or put it in a note.`;

const OPEN_AT_LOGIN_HELP = {
  on: "Compose opens without a window when you log in, so the quick note is ready. Click its Dock icon for the main window.",
  off: "The quick note works while Compose is open, even with its window closed. Turn this on to have it from the moment you log in.",
  needsApproval: "Compose is switched off under Login Items in System Settings, so it does not open at login.",
} as const;

const KEEP_SHORTCUTS_HELP = {
  on: "Quit Compose and the shortcuts still work: a small helper holds them and starts Compose with the quick note. The first press takes a moment while Compose starts.",
  off: "The shortcuts stop when you quit Compose. Turn this on to keep them: a small helper holds them from login and starts Compose when you press one.",
  needsApproval: "Compose Shortcuts is switched off under Login Items in System Settings, so the shortcuts stop when you quit Compose.",
} as const;

/**
 * "Quick note": the global shortcuts that open a small window over any app —
 * one on the notes jotted there, one on the clipboard history — whether Compose
 * opens at login to have them from then on, and whether that history is kept.
 */
export function QuickCaptureSection() {
  const [shortcuts, setShortcuts] = useState<CaptureShortcuts | null>(null);

  useEffect(() => {
    let cancelled = false;
    captureShortcuts().then(
      (current) => {
        if (!cancelled) setShortcuts(current);
      },
      () => {
        if (!cancelled) setShortcuts(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const chooseNotes = useCallback(async (next: string | null) => setShortcuts(await setCaptureShortcut("notes", next)), []);
  const chooseClipboard = useCallback(async (next: string | null) => setShortcuts(await setCaptureShortcut("clipboard", next)), []);

  // Unavailable in the browser preview, where there is no system to register with.
  if (!shortcuts) return null;

  return (
    <>
      <div className="settings-section">
        <h3>Quick note</h3>
        <ShortcutSetting
          shortcut={shortcuts.notes}
          describe={describeNotes}
          offText="Off. Turn it on to jot ideas from any app."
          choose={chooseNotes}
        />
        <LoginItemSetting service="app" id="open-at-login" label="Open Compose at login" help={OPEN_AT_LOGIN_HELP} />
        <LoginItemSetting
          service="shortcutsHelper"
          id="keep-shortcuts"
          label="Keep the shortcuts when Compose is quit"
          help={KEEP_SHORTCUTS_HELP}
        />
      </div>
      <div className="settings-section">
        <h3>Clipboard history</h3>
        <ShortcutSetting
          shortcut={shortcuts.clipboard}
          describe={describeClipboard}
          offText="No shortcut. The clipboard is still in the quick-note window."
          choose={chooseClipboard}
        />
        <ClipboardHistorySetting />
      </div>
    </>
  );
}
