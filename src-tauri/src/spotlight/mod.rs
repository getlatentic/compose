//! Spotlight: Compose indexes its notes itself, so a search on this Mac finds a
//! note by its title or words, and choosing the result opens it in Compose.
//!
//! Each note is an item named by its absolute path, in a domain named by its
//! workspace. What was sent is kept (`db::spotlight_items`), so a launch sends
//! only notes that changed. On by default; turning it off empties the index.

mod indexer;
#[cfg(target_os = "macos")]
mod mac;
mod note;
mod plan;

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::OnceLock;

use tauri::{AppHandle, Manager, State};

use crate::db::{DocumentChange, MetadataStore};
use crate::workspace::{WorkspaceList, WorkspaceRegistry};
use indexer::Job;

const SETTING_KEY: &str = "spotlight.enabled";

#[derive(Default)]
pub struct SpotlightState {
    enabled: AtomicBool,
    jobs: OnceLock<Sender<Job>>,
}

impl SpotlightState {
    fn queue(&self, job: Job) {
        if let Some(jobs) = self.jobs.get() {
            let _ = jobs.send(job);
        }
    }
}

/// Answer chosen results, and bring the index up to date with every workspace.
pub fn start(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        mac::open_results(app);
        if !mac::available() {
            return;
        }
        let (sender, jobs) = std::sync::mpsc::channel::<Job>();
        let worker = app.clone();
        std::thread::spawn(move || {
            let (metadata, registry) = (worker.state::<MetadataStore>(), worker.state::<WorkspaceRegistry>());
            let indexer = indexer::Indexer { index: &mac::CoreSpotlight, metadata: &metadata, registry: &registry };
            for job in jobs {
                if let Err(error) = indexer.run(job) {
                    eprintln!("Spotlight: {error}");
                }
            }
        });
        let state = app.state::<SpotlightState>();
        let _ = state.jobs.set(sender);
        let enabled = app.state::<MetadataStore>().app_setting::<bool>(SETTING_KEY).ok().flatten().unwrap_or(true);
        state.enabled.store(enabled, Ordering::SeqCst);
        if enabled {
            reconcile_every_workspace(app);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// A note changed: Spotlight follows.
pub fn documents_changed(app: &AppHandle, workspace_id: &str, change: &DocumentChange) {
    let state = app.state::<SpotlightState>();
    if !state.enabled.load(Ordering::SeqCst) {
        return;
    }
    let workspace_id = workspace_id.to_owned();
    state.queue(match change {
        DocumentChange::Synced => Job::Reconcile(workspace_id),
        DocumentChange::Written(path) => Job::Written { workspace_id, path: path.clone() },
        DocumentChange::Renamed { from, to } => Job::Renamed { workspace_id, from: from.clone(), to: to.clone() },
        DocumentChange::Deleted(path) => Job::Deleted { workspace_id, path: path.clone() },
    });
}

/// A workspace removed from Compose takes its notes out of Spotlight.
pub fn workspaces_changed(app: &AppHandle, list: &WorkspaceList) {
    let state = app.state::<SpotlightState>();
    if !state.enabled.load(Ordering::SeqCst) {
        return;
    }
    let Ok(indexed) = app.state::<MetadataStore>().spotlight_vaults() else {
        return;
    };
    let registered: HashSet<&str> = list.workspaces.iter().map(|workspace| workspace.id.as_str()).collect();
    for workspace_id in indexed.into_iter().filter(|id| !registered.contains(id.as_str())) {
        state.queue(Job::Forget(workspace_id));
    }
}

fn reconcile_every_workspace(app: &AppHandle) {
    let Ok(list) = app.state::<WorkspaceRegistry>().list() else {
        return;
    };
    let state = app.state::<SpotlightState>();
    for workspace in list.workspaces {
        state.queue(Job::Reconcile(workspace.id));
    }
}

#[tauri::command]
pub fn spotlight_enabled(state: State<'_, SpotlightState>) -> bool {
    state.enabled.load(Ordering::SeqCst)
}

/// Turn Spotlight on, which indexes every workspace, or off, which empties it.
#[tauri::command]
pub fn spotlight_set_enabled(
    enabled: bool,
    app: AppHandle,
    state: State<'_, SpotlightState>,
    metadata: State<'_, MetadataStore>,
) -> Result<bool, String> {
    metadata.set_app_setting(SETTING_KEY, &enabled)?;
    if state.enabled.swap(enabled, Ordering::SeqCst) != enabled {
        if enabled {
            reconcile_every_workspace(&app);
        } else {
            state.queue(Job::ForgetAll);
        }
    }
    Ok(enabled)
}
