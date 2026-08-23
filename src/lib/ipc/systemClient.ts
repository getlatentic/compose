import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import type { InstallHint } from "./harnessClient";

/**
 * One optional local-AI dependency's status (mirrors the Rust
 * `DependencyStatus`). `present` already folds in any version-floor check.
 * When absent, `hint` is the hand-off — Compose detects and links, it never
 * installs (the same contract agents get).
 */
export interface DependencyStatus {
  id: string;
  name: string;
  description: string;
  present: boolean;
  version: string | null;
  hint: InstallHint;
}

/** Probe every system dependency. `[]` in the browser preview (desktop-only). */
export async function systemReadiness(): Promise<DependencyStatus[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<DependencyStatus[]>("system_readiness");
}
