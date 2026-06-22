import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import { streamSubprocessCommand, type HarnessInstallEvent } from "./harnessClient";

/**
 * One system dependency's status from the readiness "doctor" (mirrors the Rust
 * `DependencyStatus`). `present` already folds in the version-floor check, so a
 * Node below the minimum reports `present: false` while still carrying the
 * `version` that was found. `requires` names prerequisite dependency ids the UI
 * gates on (e.g. `node` requires `homebrew`).
 */
export interface DependencyStatus {
  id: string;
  name: string;
  description: string;
  present: boolean;
  version: string | null;
  requiresAdmin: boolean;
  provides: string[];
  requires: string[];
  error: string | null;
}

/** Probe every system dependency. `[]` in the browser preview (desktop-only). */
export async function systemReadiness(): Promise<DependencyStatus[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<DependencyStatus[]>("system_readiness");
}

/**
 * Install one system dependency, streaming progress. Reuses the harness
 * install/login channel bridge — the wire event shape is the same
 * `InstallEvent`. A privileged install (Homebrew) shows its native macOS
 * password dialog on the backend; its output arrives only at completion, so the
 * UI shows a spinner for that step rather than a live log.
 */
export function systemInstallDependency(
  id: string,
): AsyncGenerator<HarnessInstallEvent, void, void> {
  return streamSubprocessCommand("system_install_dependency", { id });
}
