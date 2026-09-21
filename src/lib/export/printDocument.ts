import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import { collectMermaidSvgs } from "./mermaidSvgs";
import type { DocumentRef } from "../../app/workspaceModel";

/**
 * Open the system print panel for a document. The Rust side renders the same
 * self-contained HTML as the PDF export, then runs `NSPrintOperation` — so the
 * panel offers a real printer *and* "Save as PDF", and Compose writes no file.
 * Resolves to whether the user printed (vs cancelled the panel); no-ops in the
 * browser preview.
 */
export async function printDocument(args: {
  document: DocumentRef;
  content: string;
}): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }
  return await invoke<boolean>("document_print", {
    document: args.document,
    content: args.content,
    mermaidSvgs: await collectMermaidSvgs(args.content),
  });
}
