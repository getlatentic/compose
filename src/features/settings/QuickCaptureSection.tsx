import { useCallback, useEffect, useState } from "react";

import { captureShortcuts, setCaptureShortcut, type CaptureShortcuts } from "../../lib/ipc/captureClient";
import { ClipboardHistorySetting } from "./ClipboardHistorySetting";
import { ShortcutSetting } from "./ShortcutSetting";

const describeNotes = (label: string) => `Press ${label} in any app to jot an idea; ⌘↩ saves it into the open workspace.`;
const describeClipboard = (label: string) => `Press ${label} in any app to find what you copied, paste it again, or put it in a note.`;

/**
 * "Quick note": the global shortcuts that open a small window over any app —
 * one on the notes jotted there, one on the clipboard history — and whether
 * that history is kept.
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
