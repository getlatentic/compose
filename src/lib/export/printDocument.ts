import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import { collectMermaidSvgs } from "./mermaidSvgs";

/**
 * Open the system print panel for a document. The Rust side renders the same
 * self-contained HTML as the PDF export, then runs `NSPrintOperation` — so the
 * panel offers a real printer *and* "Save as PDF", and Compose writes no file.
 * Resolves to whether the user printed (vs cancelled the panel); no-ops in the
 * browser preview.
 */
export async function printDocument(args: {
  workspaceId: string;
  relativePath: string;
  content: string;
}): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }
  return await invoke<boolean>("workspace_print", {
    workspaceId: args.workspaceId,
    relativePath: args.relativePath,
    content: args.content,
    mermaidSvgs: await collectMermaidSvgs(args.content),
  });
}
