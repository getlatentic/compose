import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import { DESKTOP_RUNTIME_REQUIRED } from "./harnessRunClient";

/**
 * An agent's models: listing them, and pulling or deleting local ones.
 */

/** A model the harness can be pointed at (mirrors
 * `compose_core::HarnessModel`). `value` is passed verbatim to the CLI. */
export interface HarnessModel {
  value: string;
  label: string;
}

/** Launch the local Ollama app so its server comes up — the one-click fix for an
 * "Ollama isn't running" state. Rejects (with a friendly message) when Ollama
 * isn't installed. No-op in the browser preview. */
export async function startOllama(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke<void>("ollama_start");
}

/** Whether the Ollama app is installed (a filesystem check), so first-run can
 * tell a stopped server from an absent one. False in the browser preview. */
export async function ollamaInstalled(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }
  return invoke<boolean>("ollama_installed");
}

/**
 * The model ids a harness offers, discovered live (Ollama `/api/tags`, OpenCode
 * `opencode models`, models.dev for cloud providers) or its static curated list.
 * Populates the model picker for harnesses whose `capabilities.models` is empty
 * because discovery is dynamic. Best-effort: `[]` in the browser preview or on
 * any backend error (the free-text model field still applies).
 */
export async function harnessListModels(
  harnessId: string,
  /** Allow reading the stored key to authenticate the listing. Off by default:
   *  the composer and the default-model pick run at boot, and a hosted harness
   *  resolves its key when built — a keychain access at launch. Settings opts
   *  in, where an authenticated endpoint has to work. */
  withAuth = false,
): Promise<HarnessModel[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<HarnessModel[]>("harness_list_models", { harnessId, withAuth });
}

/**
 * A harness's local-model management capability (mirrors
 * `harness::ModelManagement`). `null` when the harness manages no models — the
 * Settings "Manage models" section appears only when this is non-null (Ollama).
 */
export interface HarnessModelManagement {
  /** The model server's base URL (e.g. `http://localhost:11434`) — shown / linked. */
  baseUrl: string;
}

/**
 * Whether a harness can install/list/delete its own local models, and if so its
 * endpoint metadata. `null` for every harness but Ollama (and in the browser
 * preview, which has no registry).
 */
export async function harnessModelManagement(
  harnessId: string,
): Promise<HarnessModelManagement | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  return invoke<HarnessModelManagement | null>("harness_model_management", { harnessId });
}

/** One installed local model with the metadata the manager shows (mirrors
 * `harness::InstalledModel`). `size` is on-disk bytes. */
export interface InstalledModel {
  name: string;
  size: number;
  parameterSize: string | null;
  quantizationLevel: string | null;
}

/** Installed local models with size + details, for the manager list. `[]` in the
 * browser preview or on any backend error (e.g. the server is offline). */
export async function harnessInstalledModels(harnessId: string): Promise<InstalledModel[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<InstalledModel[]>("harness_installed_models", { harnessId });
}

/**
 * A streamed model-pull event (mirrors `harness::model_manager::PullEvent`).
 * `progress.percent` is the aggregated overall percentage (0–100), absent until
 * a byte total is known; `status` is the server's raw phase text.
 */
export type PullEvent =
  | {
      kind: "progress";
      status: string;
      percent?: number;
      digest?: string;
      total?: number;
      completed?: number;
    }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * Pull (download) a model, invoking `onEvent` for each progress update and
 * resolving when the pull finishes. Terminal status arrives as a `done` or
 * `error` event (the promise still resolves — inspect the events for outcome).
 * Cancel an in-flight pull with {@link harnessCancelPull} for the same
 * `harnessId` + `model`. No-op in the browser preview (it has no registry).
 */
export async function harnessPullModel(
  harnessId: string,
  model: string,
  onEvent: (event: PullEvent) => void,
): Promise<void> {
  if (!isTauriRuntime()) {
    onEvent({ kind: "error", message: DESKTOP_RUNTIME_REQUIRED });
    return;
  }
  const { Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<PullEvent>();
  channel.onmessage = onEvent;
  await invoke<void>("harness_pull_model", { harnessId, model, onEvent: channel });
}

/** Cancel an in-flight {@link harnessPullModel} for this `harnessId` + `model`. */
export async function harnessCancelPull(harnessId: string, model: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke<void>("harness_cancel_pull", { harnessId, model });
}

/** Delete an installed local model. Removing one already absent succeeds. */
export async function harnessDeleteModel(harnessId: string, model: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke<void>("harness_delete_model", { harnessId, model });
}
