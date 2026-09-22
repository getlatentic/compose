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
        let metadata = app.state::<MetadataStore>();
        let enabled = metadata.app_setting::<bool>(SETTING_KEY).ok().flatten().unwrap_or(true);
        state.enabled.store(enabled, Ordering::SeqCst);
        let registered = registered_workspaces(app);
        for job in launch_jobs(enabled, &registered, &metadata.spotlight_vaults().unwrap_or_default()) {
            state.queue(job);
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
    let registered: Vec<String> = list.workspaces.iter().map(|workspace| workspace.id.clone()).collect();
    for job in removed(&registered, &indexed) {
        state.queue(job);
    }
}

/// At launch: empty Spotlight when it is off but holds notes, which a run that
/// ended before turning it off had finished leaves; else drop the workspaces
/// removed while Compose was not running and bring every other up to date.
fn launch_jobs(enabled: bool, registered: &[String], indexed: &[String]) -> Vec<Job> {
    if !enabled {
        return if indexed.is_empty() { Vec::new() } else { vec![Job::ForgetAll] };
    }
    let mut jobs = removed(registered, indexed);
    jobs.extend(registered.iter().cloned().map(Job::Reconcile));
    jobs
}

fn removed(registered: &[String], indexed: &[String]) -> Vec<Job> {
    let registered: HashSet<&String> = registered.iter().collect();
    indexed.iter().filter(|id| !registered.contains(id)).cloned().map(Job::Forget).collect()
}

fn registered_workspaces(app: &AppHandle) -> Vec<String> {
    app.state::<WorkspaceRegistry>()
        .list()
        .map(|list| list.workspaces.into_iter().map(|workspace| workspace.id).collect())
        .unwrap_or_default()
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
            registered_workspaces(&app).into_iter().for_each(|id| state.queue(Job::Reconcile(id)));
        } else {
            state.queue(Job::ForgetAll);
        }
    }
    Ok(enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn a_launch_drops_workspaces_removed_meanwhile_and_updates_the_rest() {
        assert_eq!(
            launch_jobs(true, &ids(&["kept", "new"]), &ids(&["kept", "removed"])),
            [Job::Forget("removed".to_owned()), Job::Reconcile("kept".to_owned()), Job::Reconcile("new".to_owned())]
        );
    }

    #[test]
    fn a_launch_with_spotlight_off_empties_what_a_previous_run_left() {
        assert_eq!(launch_jobs(false, &ids(&["a"]), &ids(&["a"])), [Job::ForgetAll]);
        assert!(launch_jobs(false, &ids(&["a"]), &[]).is_empty(), "nothing to empty, nothing to do");
    }
}
