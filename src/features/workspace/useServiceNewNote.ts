import { useWorkspaceStore } from "../../app/workspaceStore";
import { useNativeQueue } from "./useNativeQueue";

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
 * the app, or makes its window again) always sees a hydrated workspace list;
 * selections that arrive earlier sit buffered on the Rust side until this
 * drains them.
 */
export function useServiceNewNote(): void {
  useNativeQueue(NEW_NOTE_EVENT, DRAIN_PENDING_CMD, writeSelection);
}

async function writeSelection(selection: string): Promise<void> {
  if (!selection) return;
  await useWorkspaceStore.getState().createNote({ content: noteFromSelection(selection) });
}
