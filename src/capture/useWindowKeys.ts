import { useEffect, useRef } from "react";

import type { QuickNoteView } from "./captureApi";

export interface WindowKeys {
  view: QuickNoteView;
  close(): void;
  save(): void;
  newNote(): void;
  insertClip(): void;
  pinClip(): void;
  switchView(): void;
  stepNote(step: number): void;
}

/**
 * The window's own shortcuts. They are caught before the editor sees them —
 * the editor would take ⌘↩ as a new line — and only these keys are taken.
 *
 *   Esc     close              ⌘↩   save the note / put the clip in the note
 *   ⌘N      new note           ⌘P   pin the clip
 *   ⌃Tab    notes ↔ clipboard  ⌃⌘↑ ⌃⌘↓  previous / next note
 */
export function useWindowKeys(keys: WindowKeys): void {
  const latest = useRef(keys);
  latest.current = keys;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = actionFor(event, latest.current);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

function actionFor(event: KeyboardEvent, keys: WindowKeys): (() => void) | null {
  const command = event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  if (event.key === "Escape" && !insideLinkField(event.target)) return keys.close;
  if (command && event.key === "Enter") return keys.view === "notes" ? keys.save : keys.insertClip;
  if (command && event.key.toLowerCase() === "n") return keys.newNote;
  if (command && event.key.toLowerCase() === "p" && keys.view === "clipboard") return keys.pinClip;
  if (event.ctrlKey && !event.metaKey && event.key === "Tab") return keys.switchView;
  if (event.ctrlKey && event.metaKey && keys.view === "notes" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    return () => keys.stepNote(event.key === "ArrowUp" ? -1 : 1);
  }
  return null;
}

/** The link field closes itself on Esc; the window stays open. */
function insideLinkField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".quick-note-toolbar__link") !== null;
}
