import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";

/**
 * Agents the writer adds themselves.
 */

// ----- Custom agents (user-registered ACP / OpenAI-compatible) ----------------

/** A custom agent's kind + per-kind config (mirrors Rust `CustomAgentKind`). */
export type CustomAgentKind =
  | { type: "acp"; command: string; args: string[] }
  | {
      type: "openAiCompatible";
      baseUrl: string;
      defaultModel?: string | null;
      requiresKey: boolean;
    };

/** A persisted custom agent. `id` is host-assigned (`custom:<uuid>`). */
export interface CustomAgentRecord {
  id: string;
  displayName: string;
  kind: CustomAgentKind;
}

/** What the Add-agent form sends — a record without the host-assigned id. */
export interface CustomAgentInput {
  displayName: string;
  kind: CustomAgentKind;
}

export async function harnessListCustom(): Promise<CustomAgentRecord[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<CustomAgentRecord[]>("harness_list_custom");
}

export async function harnessAddCustom(input: CustomAgentInput): Promise<CustomAgentRecord> {
  if (!isTauriRuntime()) {
    throw new Error("Adding a custom agent needs the desktop app.");
  }
  return invoke<CustomAgentRecord>("harness_add_custom", { input });
}

export async function harnessUpdateCustom(record: CustomAgentRecord): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke<void>("harness_update_custom", { record });
}

export async function harnessRemoveCustom(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke<void>("harness_remove_custom", { id });
}
