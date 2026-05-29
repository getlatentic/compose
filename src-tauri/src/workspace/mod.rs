use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatus {
    pub exists: bool,
    pub is_directory: bool,
    pub path: Option<String>,
    pub selected: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTabs {
    #[serde(default)]
    pub active_file_path: String,
    #[serde(default)]
    pub open_file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tabs: Option<WorkspaceTabs>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceList {
    pub active_workspace_id: Option<String>,
    pub onboarding: OnboardingState,
    pub workspaces: Vec<WorkspaceRecord>,
}

#[derive(Default)]
pub struct WorkspaceRegistry {
    state: Mutex<WorkspaceRegistryState>,
}

#[derive(Debug, Default)]
struct WorkspaceRegistryState {
    active_workspace_id: Option<String>,
    onboarding: OnboardingState,
    persist_path: Option<PathBuf>,
    workspaces: Vec<WorkspaceRecord>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedRegistry {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    active_workspace_id: Option<String>,
    #[serde(default)]
    onboarding: OnboardingState,
    #[serde(default)]
    workspaces: Vec<WorkspaceRecord>,
}

const PERSIST_VERSION: u32 = 1;
const REGISTRY_FILE_NAME: &str = "workspaces.json";

impl WorkspaceRegistry {
    pub fn init_from_app(&self, app: &AppHandle) -> Result<(), String> {
        let config_dir = app
            .path()
            .app_config_dir()
            .map_err(|error| format!("app config dir unavailable: {error}"))?;
        self.init_from_dir(&config_dir)
    }

    pub fn init_from_dir(&self, config_dir: &Path) -> Result<(), String> {
        std::fs::create_dir_all(config_dir)
            .map_err(|error| format!("could not create config dir: {error}"))?;
        let persist_path = config_dir.join(REGISTRY_FILE_NAME);
        let loaded = load_persisted_registry(&persist_path)?;

        let mut state = self.lock_state()?;
        state.persist_path = Some(persist_path);
        state.onboarding = loaded.onboarding;
        state.workspaces = loaded
            .workspaces
            .into_iter()
            .filter(|record| Path::new(&record.path).is_dir())
            .collect();
        state.active_workspace_id = loaded.active_workspace_id.and_then(|id| {
            state
                .workspaces
                .iter()
                .any(|workspace| workspace.id == id)
                .then_some(id)
        });
        if state.active_workspace_id.is_none() {
            state.active_workspace_id = state
                .workspaces
                .first()
                .map(|workspace| workspace.id.clone());
        }
        Ok(())
    }

    pub fn add(&self, raw_path: String) -> Result<WorkspaceList, String> {
        let (name, path) = workspace_descriptor_for_path(raw_path)?;
        let mut state = self.lock_state()?;

        if let Some(existing) = state
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.path == path)
        {
            existing.last_opened_at = Some(now_ms());
            state.active_workspace_id = Some(existing.id.clone());
        } else {
            let record = WorkspaceRecord {
                id: Uuid::new_v4().to_string(),
                name,
                path,
                tabs: None,
                last_opened_at: Some(now_ms()),
            };
            state.active_workspace_id = Some(record.id.clone());
            state.workspaces.push(record.clone());
        }

        let list = state.to_list();
        persist_state(&state)?;
        Ok(list)
    }

    pub fn list(&self) -> Result<WorkspaceList, String> {
        Ok(self.lock_state()?.to_list())
    }

    pub fn remove(&self, workspace_id: String) -> Result<WorkspaceList, String> {
        validate_workspace_id(&workspace_id)?;
        let mut state = self.lock_state()?;
        let initial_len = state.workspaces.len();
        state
            .workspaces
            .retain(|workspace| workspace.id != workspace_id);

        if state.workspaces.len() == initial_len {
            return Err("workspace is not registered".to_owned());
        }

        if state.active_workspace_id.as_deref() == Some(workspace_id.as_str()) {
            state.active_workspace_id = state
                .workspaces
                .first()
                .map(|workspace| workspace.id.clone());
        }

        let list = state.to_list();
        persist_state(&state)?;
        Ok(list)
    }

    pub fn switch(&self, workspace_id: String) -> Result<WorkspaceList, String> {
        validate_workspace_id(&workspace_id)?;
        let mut state = self.lock_state()?;
        let workspace = state
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == workspace_id);
        let Some(workspace) = workspace else {
            return Err("workspace is not registered".to_owned());
        };
        workspace.last_opened_at = Some(now_ms());

        state.active_workspace_id = Some(workspace_id);
        let list = state.to_list();
        persist_state(&state)?;
        Ok(list)
    }

    pub fn workspace_root(&self, workspace_id: &str) -> Result<PathBuf, String> {
        let state = self.lock_state()?;
        state
            .workspaces
            .iter()
            .find(|workspace| workspace.id == workspace_id)
            .map(|workspace| PathBuf::from(&workspace.path))
            .ok_or_else(|| "workspace is not registered".to_owned())
    }

    pub fn update_tabs(&self, workspace_id: &str, tabs: WorkspaceTabs) -> Result<(), String> {
        validate_workspace_id(workspace_id)?;
        let mut state = self.lock_state()?;
        let workspace = state
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == workspace_id)
            .ok_or_else(|| "workspace is not registered".to_owned())?;
        workspace.tabs = Some(tabs);
        persist_state(&state)
    }

    pub fn mark_opened(&self, workspace_id: &str) -> Result<WorkspaceList, String> {
        validate_workspace_id(workspace_id)?;
        let mut state = self.lock_state()?;
        let workspace = state
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == workspace_id)
            .ok_or_else(|| "workspace is not registered".to_owned())?;
        workspace.last_opened_at = Some(now_ms());
        let list = state.to_list();
        persist_state(&state)?;
        Ok(list)
    }

    pub fn onboarding(&self) -> Result<OnboardingState, String> {
        Ok(self.lock_state()?.onboarding.clone())
    }

    pub fn complete_onboarding(&self) -> Result<OnboardingState, String> {
        let mut state = self.lock_state()?;
        if state.onboarding.completed_at.is_none() {
            state.onboarding.completed_at = Some(now_ms());
        }
        let onboarding = state.onboarding.clone();
        persist_state(&state)?;
        Ok(onboarding)
    }

    pub fn resolve_workspace_path(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<PathBuf, String> {
        let root = self.workspace_root(workspace_id)?;
        let safe_relative = sanitize_relative_path(relative_path)?;
        Ok(root.join(safe_relative))
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, WorkspaceRegistryState>, String> {
        self.state
            .lock()
            .map_err(|_| "workspace registry lock was poisoned".to_owned())
    }
}

#[tauri::command(async)]
pub fn workspace_status(path: Option<String>) -> Result<WorkspaceStatus, String> {
    match path {
        None => Ok(WorkspaceStatus {
            exists: false,
            is_directory: false,
            path: None,
            selected: false,
        }),
        Some(raw_path) => status_for_path(raw_path),
    }
}

#[tauri::command(async)]
pub fn workspace_add(
    path: String,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<WorkspaceList, String> {
    registry.add(path)
}

#[tauri::command(async)]
pub fn workspace_list(registry: State<'_, WorkspaceRegistry>) -> Result<WorkspaceList, String> {
    registry.list()
}

#[tauri::command(async)]
pub fn workspace_remove(
    workspace_id: String,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<WorkspaceList, String> {
    registry.remove(workspace_id)
}

#[tauri::command(async)]
pub fn workspace_switch(
    workspace_id: String,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<WorkspaceList, String> {
    registry.switch(workspace_id)
}

#[tauri::command(async)]
pub fn workspace_mark_opened(
    workspace_id: String,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<WorkspaceList, String> {
    registry.mark_opened(&workspace_id)
}

#[tauri::command(async)]
pub fn setup_get_onboarding(
    registry: State<'_, WorkspaceRegistry>,
) -> Result<OnboardingState, String> {
    registry.onboarding()
}

#[tauri::command(async)]
pub fn setup_complete_onboarding(
    registry: State<'_, WorkspaceRegistry>,
) -> Result<OnboardingState, String> {
    registry.complete_onboarding()
}

#[tauri::command(async)]
pub fn workspace_save_tabs(
    workspace_id: String,
    active_file_path: String,
    open_file_paths: Vec<String>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<(), String> {
    registry.update_tabs(
        &workspace_id,
        WorkspaceTabs {
            active_file_path,
            open_file_paths,
        },
    )
}

fn status_for_path(raw_path: String) -> Result<WorkspaceStatus, String> {
    let path = normalize_workspace_path(raw_path)?;
    let metadata = std::fs::metadata(&path);

    Ok(WorkspaceStatus {
        exists: metadata.is_ok(),
        is_directory: metadata.map(|value| value.is_dir()).unwrap_or(false),
        path: Some(path.to_string_lossy().to_string()),
        selected: true,
    })
}

fn workspace_descriptor_for_path(raw_path: String) -> Result<(String, String), String> {
    let path = normalize_workspace_path(raw_path)?;
    let metadata =
        std::fs::metadata(&path).map_err(|_| "workspace path does not exist".to_owned())?;

    if !metadata.is_dir() {
        return Err("workspace path must be a directory".to_owned());
    }

    let canonical_path = path
        .canonicalize()
        .map_err(|_| "workspace path could not be resolved".to_owned())?;

    Ok((
        workspace_name_for_path(&canonical_path),
        canonical_path.to_string_lossy().to_string(),
    ))
}

fn normalize_workspace_path(raw_path: String) -> Result<PathBuf, String> {
    let trimmed_path = raw_path.trim();
    if trimmed_path.is_empty() {
        return Err("workspace path cannot be blank".to_owned());
    }

    Ok(PathBuf::from(trimmed_path))
}

fn workspace_name_for_path(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn validate_workspace_id(workspace_id: &str) -> Result<(), String> {
    if workspace_id.trim().is_empty() {
        return Err("workspace id cannot be blank".to_owned());
    }

    Ok(())
}

pub fn sanitize_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err("relative path cannot be blank".to_owned());
    }

    let candidate = PathBuf::from(trimmed);
    let mut safe = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(segment) => safe.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("relative path must stay inside the workspace".to_owned());
            }
        }
    }

    if safe.as_os_str().is_empty() {
        return Err("relative path cannot be blank".to_owned());
    }

    Ok(safe)
}

fn load_persisted_registry(persist_path: &Path) -> Result<PersistedRegistry, String> {
    match std::fs::read_to_string(persist_path) {
        Ok(contents) if contents.trim().is_empty() => Ok(PersistedRegistry::default()),
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|error| format!("workspaces.json is malformed: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(PersistedRegistry::default())
        }
        Err(error) => Err(format!("could not read workspaces.json: {error}")),
    }
}

fn persist_state(state: &WorkspaceRegistryState) -> Result<(), String> {
    let Some(persist_path) = state.persist_path.as_ref() else {
        return Ok(());
    };

    let payload = PersistedRegistry {
        version: PERSIST_VERSION,
        active_workspace_id: state.active_workspace_id.clone(),
        onboarding: state.onboarding.clone(),
        workspaces: state.workspaces.clone(),
    };
    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("could not serialize workspaces: {error}"))?;

    if let Some(parent) = persist_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not create config dir: {error}"))?;
    }
    std::fs::write(persist_path, serialized)
        .map_err(|error| format!("could not write workspaces.json: {error}"))?;
    Ok(())
}

impl WorkspaceRegistryState {
    fn to_list(&self) -> WorkspaceList {
        WorkspaceList {
            active_workspace_id: self.active_workspace_id.clone(),
            onboarding: self.onboarding.clone(),
            workspaces: self.workspaces.clone(),
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn returns_unselected_status_without_path() {
        assert_eq!(
            workspace_status(None).expect("status"),
            WorkspaceStatus {
                exists: false,
                is_directory: false,
                path: None,
                selected: false,
            }
        );
    }

    #[test]
    fn rejects_blank_path() {
        assert_eq!(
            workspace_status(Some(" ".to_owned())).expect_err("blank path must fail"),
            "workspace path cannot be blank"
        );
    }

    #[test]
    fn reports_existing_directory() {
        let current_dir = std::env::current_dir().expect("current dir");
        let status = workspace_status(Some(current_dir.to_string_lossy().to_string()))
            .expect("directory status");

        assert!(status.exists);
        assert!(status.is_directory);
        assert!(status.selected);
    }

    #[test]
    fn registers_switches_and_removes_workspaces() {
        let registry = WorkspaceRegistry::default();
        let current_dir = std::env::current_dir().expect("current dir");
        let first_list = registry
            .add(current_dir.to_string_lossy().to_string())
            .expect("add workspace");

        assert_eq!(first_list.workspaces.len(), 1);
        assert_eq!(
            first_list.active_workspace_id,
            Some(first_list.workspaces[0].id.clone())
        );

        let switched_list = registry
            .switch(first_list.workspaces[0].id.clone())
            .expect("switch workspace");
        assert_eq!(
            switched_list.active_workspace_id,
            first_list.active_workspace_id
        );

        let removed_list = registry
            .remove(first_list.workspaces[0].id.clone())
            .expect("remove workspace");
        assert_eq!(removed_list.workspaces.len(), 0);
        assert_eq!(removed_list.active_workspace_id, None);
    }

    #[test]
    fn rejects_unknown_workspace_switch() {
        let registry = WorkspaceRegistry::default();

        assert_eq!(
            registry
                .switch("workspace-missing".to_owned())
                .expect_err("missing workspace must fail"),
            "workspace is not registered"
        );
    }

    #[test]
    fn sanitize_rejects_parent_traversal() {
        assert!(sanitize_relative_path("../etc/passwd").is_err());
        assert!(sanitize_relative_path("/etc/passwd").is_err());
        assert!(sanitize_relative_path("notes/../../escape.md").is_err());
        assert!(sanitize_relative_path("").is_err());
        assert!(sanitize_relative_path("   ").is_err());
    }

    #[test]
    fn sanitize_accepts_nested_relative_paths() {
        assert_eq!(
            sanitize_relative_path("notes/launch-plan.md").expect("ok"),
            PathBuf::from("notes/launch-plan.md")
        );
        assert_eq!(
            sanitize_relative_path("./inner/file.md").expect("ok"),
            PathBuf::from("inner/file.md")
        );
    }

    #[test]
    fn resolve_workspace_path_joins_under_registered_root() {
        let dir = tempdir().expect("tempdir");
        let registry = WorkspaceRegistry::default();
        let list = registry
            .add(dir.path().to_string_lossy().to_string())
            .expect("add");
        let workspace_id = list.workspaces[0].id.clone();
        let root = registry.workspace_root(&workspace_id).expect("root");

        let resolved = registry
            .resolve_workspace_path(&workspace_id, "notes/launch-plan.md")
            .expect("resolve");
        assert!(resolved.starts_with(&root));
        assert!(resolved.ends_with("notes/launch-plan.md"));
    }

    #[test]
    fn resolve_workspace_path_rejects_traversal() {
        let dir = tempdir().expect("tempdir");
        let registry = WorkspaceRegistry::default();
        let list = registry
            .add(dir.path().to_string_lossy().to_string())
            .expect("add");
        let workspace_id = list.workspaces[0].id.clone();

        assert!(registry
            .resolve_workspace_path(&workspace_id, "../escape.md")
            .is_err());
        assert!(registry
            .resolve_workspace_path(&workspace_id, "/etc/passwd")
            .is_err());
    }

    #[test]
    fn registry_persists_and_loads_from_disk() {
        let dir = tempdir().expect("tempdir");
        let workspace_dir = tempdir().expect("workspace dir");
        let workspace_path = workspace_dir.path().to_string_lossy().to_string();

        let first = WorkspaceRegistry::default();
        first.init_from_dir(dir.path()).expect("init");
        let added = first.add(workspace_path.clone()).expect("add");
        assert_eq!(added.workspaces.len(), 1);

        let second = WorkspaceRegistry::default();
        second.init_from_dir(dir.path()).expect("re-init");
        let loaded = second.list().expect("list");
        assert_eq!(loaded.workspaces.len(), 1);
        assert_eq!(
            loaded.active_workspace_id,
            Some(loaded.workspaces[0].id.clone())
        );
        assert_eq!(loaded.workspaces[0].path, added.workspaces[0].path);
    }

    #[test]
    fn update_tabs_persists_open_files_per_workspace() {
        let dir = tempdir().expect("config dir");
        let workspace_dir = tempdir().expect("workspace dir");

        let first = WorkspaceRegistry::default();
        first.init_from_dir(dir.path()).expect("init");
        let list = first
            .add(workspace_dir.path().to_string_lossy().to_string())
            .expect("add");
        let workspace_id = list.workspaces[0].id.clone();

        first
            .update_tabs(
                &workspace_id,
                WorkspaceTabs {
                    active_file_path: "notes/active.md".to_owned(),
                    open_file_paths: vec!["notes/active.md".to_owned(), "runs/log.md".to_owned()],
                },
            )
            .expect("save tabs");

        let second = WorkspaceRegistry::default();
        second.init_from_dir(dir.path()).expect("re-init");
        let reloaded = second.list().expect("list");
        let tabs = reloaded.workspaces[0]
            .tabs
            .as_ref()
            .expect("tabs persisted");
        assert_eq!(tabs.active_file_path, "notes/active.md");
        assert_eq!(
            tabs.open_file_paths,
            vec!["notes/active.md".to_owned(), "runs/log.md".to_owned()]
        );
    }

    #[test]
    fn mark_opened_bumps_last_opened_and_persists() {
        let dir = tempdir().expect("config");
        let workspace_dir = tempdir().expect("workspace");

        let registry = WorkspaceRegistry::default();
        registry.init_from_dir(dir.path()).expect("init");
        let added = registry
            .add(workspace_dir.path().to_string_lossy().to_string())
            .expect("add");
        let workspace_id = added.workspaces[0].id.clone();
        let after_add = added.workspaces[0].last_opened_at;
        assert!(after_add.is_some());

        std::thread::sleep(std::time::Duration::from_millis(5));
        let after_mark = registry.mark_opened(&workspace_id).expect("mark");
        assert!(after_mark.workspaces[0].last_opened_at.unwrap() > after_add.unwrap());

        let second = WorkspaceRegistry::default();
        second.init_from_dir(dir.path()).expect("re-init");
        let reloaded = second.list().expect("list");
        assert!(reloaded.workspaces[0].last_opened_at.is_some());
    }

    #[test]
    fn complete_onboarding_sets_and_persists() {
        let dir = tempdir().expect("config");
        let registry = WorkspaceRegistry::default();
        registry.init_from_dir(dir.path()).expect("init");
        assert!(registry.onboarding().expect("get").completed_at.is_none());

        let completed = registry.complete_onboarding().expect("complete");
        assert!(completed.completed_at.is_some());

        let second_call = registry.complete_onboarding().expect("idempotent");
        assert_eq!(second_call.completed_at, completed.completed_at);

        let next = WorkspaceRegistry::default();
        next.init_from_dir(dir.path()).expect("re-init");
        let onboarding = next.onboarding().expect("get");
        assert_eq!(onboarding.completed_at, completed.completed_at);
    }

    #[test]
    fn registry_drops_missing_paths_on_load() {
        let dir = tempdir().expect("tempdir");
        let persist_path = dir.path().join(REGISTRY_FILE_NAME);
        let payload = serde_json::json!({
            "version": 1,
            "activeWorkspaceId": "workspace-missing",
            "workspaces": [
                { "id": "workspace-missing", "name": "gone", "path": "/no/such/dir-xyz-bob" }
            ]
        });
        std::fs::write(&persist_path, payload.to_string()).expect("seed");

        let registry = WorkspaceRegistry::default();
        registry.init_from_dir(dir.path()).expect("init");
        let listed = registry.list().expect("list");
        assert!(listed.workspaces.is_empty());
        assert!(listed.active_workspace_id.is_none());
    }
}
