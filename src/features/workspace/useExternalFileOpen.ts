import { resolveOpenPath } from "../../lib/ipc/externalFilesClient";
import { addWorkspace } from "../../lib/ipc/workspaceClient";
import { showErrorToast } from "../toast/toastStore";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { showAddedWorkspace } from "./showAddedWorkspace";
import { useNativeQueue } from "./useNativeQueue";

const EXTERNAL_FILE_OPEN_EVENT = "compose:open-external-file";
const DRAIN_PENDING_URLS_CMD = "drain_pending_open_urls";

/**
 * Route OS-opened files (Finder Open-With, `open -a Compose file.md`).
 *
 * A file inside a registered workspace opens IN PLACE: switch to that
 * workspace and select it — never mount a new workspace. Anything else joins
 * the External-files list and opens as a loose tab at its real absolute path
 * — nothing mounted, nothing copied.
 *
 * Mounted by MainApp, which exists only after boot hydration — so the
 * cold-start drain always sees the hydrated workspace list. URLs that arrive
 * earlier (launch-by-double-click, during onboarding, or while the main window
 * is closed) sit buffered on the Rust side until this drains them.
 */
/**
 * Route one absolute path the way an OS open would: inside a registered
 * workspace → switch + select in place; anywhere else → external-files tab; a
 * folder, such as a vault Obsidian hands over → open it as a workspace.
 * Shared by the Finder open events below and File → Open File… (⌘O).
 */
export async function openPathFromOs(absolutePath: string): Promise<void> {
  if (!absolutePath) return;
  try {
    const target = await resolveOpenPath(absolutePath);
    const store = useWorkspaceStore.getState();
    if (target.kind === "folder") {
      showAddedWorkspace(await addWorkspace(target.path));
    } else if (target.kind === "workspace") {
      if (store.activeWorkspaceId !== target.workspaceId) {
        store.switchWorkspace(target.workspaceId);
      }
      await useWorkspaceStore.getState().selectFile(target.relativePath);
    } else {
      await store.openLooseFile(target.path);
    }
  } catch (error) {
    showErrorToast(error instanceof Error ? error.message : "Could not open file");
  }
}

export function useExternalFileOpen(): void {
  useNativeQueue(EXTERNAL_FILE_OPEN_EVENT, DRAIN_PENDING_URLS_CMD, openPathFromOs);
}
