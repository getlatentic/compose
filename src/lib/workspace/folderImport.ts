/**
 * Browser folder import — the "copy in" step of the virtual workspace.
 *
 * Uses `<input type="file" webkitdirectory>`, which every modern browser
 * supports (Chrome/Edge/Firefox/Safari). It's a one-shot copy: the user
 * picks a folder, we read its Markdown files into the virtual workspace,
 * and work proceeds on that copy (no live link / write-back — that's the
 * agreed browser model). On the desktop, folder opening uses the native
 * Tauri picker instead, so this path is browser-only.
 */

import { isTauriRuntime } from "../runtime/desktopRuntime";
import { vwImport } from "./virtualWorkspace";

export interface ImportedFile {
  relativePath: string;
  content: string;
}

export interface FolderImport {
  folderName: string;
  files: ImportedFile[];
}

/** True when the browser folder-import path applies (i.e. not desktop). */
export function canImportFolder(): boolean {
  return !isTauriRuntime();
}

/** Copy imported files into the workspace's virtual store (replacing it). */
export async function applyImportedFolder(
  workspaceId: string,
  files: ImportedFile[],
): Promise<void> {
  await vwImport(workspaceId, files);
}

/**
 * Prompt for a folder and read its Markdown files. Resolves `null` if the
 * user cancels. Non-`.md` files are skipped (the index only covers
 * Markdown); `folderName` is the picked directory's name, used to name the
 * workspace.
 */
export async function importFolderFromPicker(): Promise<FolderImport | null> {
  const selected = await openDirectoryPicker();
  if (!selected || selected.length === 0) {
    return null;
  }

  let folderName = "Imported folder";
  const files: ImportedFile[] = [];
  for (const file of Array.from(selected)) {
    // webkitRelativePath is "<pickedFolder>/nested/file.md"; strip the
    // leading folder segment so paths are workspace-relative.
    const rawPath = file.webkitRelativePath || file.name;
    const segments = rawPath.split("/");
    if (segments.length > 1) {
      folderName = segments[0];
    }
    const relativePath = segments.length > 1 ? segments.slice(1).join("/") : rawPath;
    if (!relativePath.toLowerCase().endsWith(".md")) {
      continue;
    }
    files.push({ content: await file.text(), relativePath });
  }
  return { files, folderName };
}

function openDirectoryPicker(): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.style.display = "none";

    const finish = (value: FileList | null) => {
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", () => finish(input.files));
    // Fires in modern browsers when the picker is dismissed without a
    // selection, so the returned promise never hangs.
    input.addEventListener("cancel", () => finish(null));

    document.body.appendChild(input);
    input.click();
  });
}
