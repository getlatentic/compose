import { invoke } from "@tauri-apps/api/core";
import { createWorkspaceId, normalizeWorkspacePath } from "../../app/workspaceModel";
import { isTauriRuntime } from "../runtime/desktopRuntime";

export interface WorkspaceStatus {
  exists: boolean;
  isDirectory: boolean;
  path: string | null;
  selected: boolean;
}

export interface WorkspaceTabs {
  activeFilePath: string;
  openFilePaths: string[];
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  path: string;
  tabs?: WorkspaceTabs;
  lastOpenedAt?: number;
}

export interface OnboardingState {
  completedAt?: number;
}

export interface WorkspaceListResult {
  activeWorkspaceId: string | null;
  onboarding: OnboardingState;
  workspaces: WorkspaceRecord[];
}

// In-memory only. The browser preview is ephemeral by design — persistence
// belongs in the Rust backend (workspaces.json), reached via Tauri.
let devList: WorkspaceListResult = {
  activeWorkspaceId: null,
  onboarding: {},
  workspaces: [],
};

function mutateDevList(transform: (current: WorkspaceListResult) => WorkspaceListResult) {
  devList = transform(devList);
  return devList;
}

export function getWorkspaceStatus(path?: string) {
  return invoke<WorkspaceStatus>("workspace_status", { path });
}

export async function addWorkspace(path: string) {
  if (!isTauriRuntime()) {
    const normalizedPath = normalizeWorkspacePath(path);
    const id = createWorkspaceId(normalizedPath);
    return mutateDevList((current) => {
      const existing = current.workspaces.find((item) => item.id === id);
      const nowMs = Date.now();
      const workspaces = existing
        ? current.workspaces.map((item) =>
            item.id === id ? { ...item, lastOpenedAt: nowMs } : item,
          )
        : [
            ...current.workspaces,
            {
              id,
              name: workspaceNameFromPath(normalizedPath),
              path: normalizedPath,
              lastOpenedAt: nowMs,
            },
          ];
      return { ...current, activeWorkspaceId: id, workspaces };
    });
  }

  return invoke<WorkspaceListResult>("workspace_add", { path });
}

export function canUseNativeFolderPicker() {
  return isTauriRuntime();
}

export async function selectWorkspaceFolder() {
  if (!isTauriRuntime()) {
    return null;
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selectedPath = await open({
    directory: true,
    multiple: false,
    title: "Open workspace folder",
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export async function listWorkspaces() {
  if (!isTauriRuntime()) {
    return devList;
  }

  return invoke<WorkspaceListResult>("workspace_list");
}

export async function removeWorkspace(workspaceId: string) {
  if (!isTauriRuntime()) {
    return mutateDevList((current) => {
      const workspaces = current.workspaces.filter((item) => item.id !== workspaceId);
      const activeWorkspaceId =
        current.activeWorkspaceId === workspaceId
          ? workspaces[0]?.id ?? null
          : current.activeWorkspaceId;
      return { ...current, activeWorkspaceId, workspaces };
    });
  }

  return invoke<WorkspaceListResult>("workspace_remove", { workspaceId });
}

export async function saveWorkspaceTabs(
  workspaceId: string,
  activeFilePath: string,
  openFilePaths: string[],
): Promise<void> {
  if (!isTauriRuntime()) {
    mutateDevList((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? { ...workspace, tabs: { activeFilePath, openFilePaths } }
          : workspace,
      ),
    }));
    return;
  }

  await invoke<void>("workspace_save_tabs", {
    workspaceId,
    activeFilePath,
    openFilePaths,
  });
}

export async function switchWorkspace(workspaceId: string) {
  if (!isTauriRuntime()) {
    return mutateDevList((current) => {
      const exists = current.workspaces.find((item) => item.id === workspaceId);
      if (!exists) {
        throw new Error("workspace is not registered");
      }
      const nowMs = Date.now();
      return {
        ...current,
        activeWorkspaceId: workspaceId,
        workspaces: current.workspaces.map((item) =>
          item.id === workspaceId ? { ...item, lastOpenedAt: nowMs } : item,
        ),
      };
    });
  }

  return invoke<WorkspaceListResult>("workspace_switch", { workspaceId });
}

export async function markWorkspaceOpened(workspaceId: string) {
  if (!isTauriRuntime()) {
    return mutateDevList((current) => ({
      ...current,
      workspaces: current.workspaces.map((item) =>
        item.id === workspaceId ? { ...item, lastOpenedAt: Date.now() } : item,
      ),
    }));
  }
  return invoke<WorkspaceListResult>("workspace_mark_opened", { workspaceId });
}

export async function getOnboarding(): Promise<OnboardingState> {
  if (!isTauriRuntime()) {
    return devList.onboarding;
  }
  return invoke<OnboardingState>("setup_get_onboarding");
}

export async function completeOnboarding(): Promise<OnboardingState> {
  if (!isTauriRuntime()) {
    const next = mutateDevList((current) => ({
      ...current,
      onboarding: current.onboarding.completedAt
        ? current.onboarding
        : { completedAt: Date.now() },
    }));
    return next.onboarding;
  }
  return invoke<OnboardingState>("setup_complete_onboarding");
}

function workspaceNameFromPath(path: string) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
