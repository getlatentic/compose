import { useEffect } from "react";

import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { useWorkspaceStore } from "../../app/workspaceStore";

const NEW_NOTE_EVENT = "compose:new-note-from-selection";
const DRAIN_PENDING_CMD = "drain_pending_service_text";

const HEADING = /^\s*#{1,6}\s+\S/;

/**
 * A captured selection as note content. Text lifted from a Markdown document
 * usually arrives with its own heading; anything else gets the same untitled
 * heading as a note made with ⌘N, so it reads and renames like every other new
 * note rather than guessing a title from prose.
 */
export function noteFromSelection(selection: string): string {
  const body = selection.replace(/\s+$/, "");
  const content = HEADING.test(body) ? body : `# Untitled\n\n${body}`;
  return `${content}\n`;
}

/**
 * Route the macOS Services menu ("New Note in Compose") — a selection in any
 * app becomes a note in the active workspace.
 *
 * Mounted by MainApp, so the cold-start drain (a Service can be what launches
 * the app) always sees a hydrated workspace list; selections that arrive
 * earlier sit buffered on the Rust side until this drains them.
 */
export function useServiceNewNote(): void {
  useEffect(function bindServiceNewNote() {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;

    async function write(selection: string) {
      if (disposed || !selection) return;
      await useWorkspaceStore.getState().createNote({ content: noteFromSelection(selection) });
    }

    void (async () => {
      const tauri = await import("@tauri-apps/api/core");
      const eventApi = await import("@tauri-apps/api/event");
      if (disposed) return;
      try {
        const pending = await tauri.invoke<string[]>(DRAIN_PENDING_CMD);
        for (const selection of pending) {
          await write(selection);
        }
      } catch (error) {
        console.error("Failed to drain pending service text:", error);
      }
      if (disposed) return;
      unlisten = await eventApi.listen<string>(NEW_NOTE_EVENT, (event) => {
        void write(event.payload);
      });
    })();

    return function unbind() {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);
}
