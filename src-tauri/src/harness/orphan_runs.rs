//! Crash-survival bookkeeping for agent child processes.
//!
//! A run's agent (claude / codex / bob, all node-backed) is a child of the
//! Compose process. A graceful quit cancels it (see [`RunnerState::cancel_all`]
//! in [`super::runner`]), but a hard crash — SIGKILL, a panic, a force-quit —
//! orphans it: the child keeps running, and an edit-capable agent can keep
//! writing the user's files with no UI to stop it.
//!
//! So the runner mirrors its live runs' pids to a small file, and on the next
//! launch we kill any that survived. Everything here is best-effort — a failed
//! read or write never blocks a run — and conservative: we only kill a live pid
//! whose process name is one we actually spawn, so a pid the OS has since reused
//! for an unrelated process is left alone.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const FILE: &str = "active-runs.json";

/// Process names we spawn agents as (node script CLIs report as `node`; codex /
/// claude / bob may also report their own name). A recorded pid is only killed
/// on boot when its live process name is in this set — the reuse guard.
#[cfg(unix)]
const AGENT_PROCESS_NAMES: [&str; 5] = ["node", "claude", "codex", "bob", "ollama"];

fn file_path(data_dir: &Path) -> PathBuf {
    data_dir.join(FILE)
}

/// Overwrite the active-runs file with the current `run_id -> pid` set. Called
/// whenever the live set changes (a run attaches its child, or finishes).
pub fn write(data_dir: &Path, pids: &BTreeMap<String, u32>) {
    let Ok(json) = serde_json::to_string(pids) else {
        return;
    };
    let _ = std::fs::write(file_path(data_dir), json);
}

/// Kill agent processes a prior session recorded but never cleaned up (it
/// crashed), then clear the file. A live pid is killed only when its process
/// name is one we spawn agents as, so a reused pid is left untouched. Runs once
/// at startup, before this session records any run of its own.
pub fn sweep(data_dir: &Path) {
    let path = file_path(data_dir);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return; // No prior file (clean first run) — nothing to sweep.
    };
    let pids: BTreeMap<String, u32> = serde_json::from_str(&text).unwrap_or_default();
    for pid in pids.values().copied() {
        if is_orphan_agent(pid) {
            kill(pid);
        }
    }
    let _ = std::fs::remove_file(&path);
}

/// Whether `pid` is a live process whose name marks it as one of our agents —
/// the guard against killing a pid the OS reused for something unrelated.
#[cfg(unix)]
fn is_orphan_agent(pid: u32) -> bool {
    // `ps -p <pid> -o comm=` prints the executable path (empty when dead).
    let Ok(output) = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
    else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let comm = String::from_utf8_lossy(&output.stdout);
    let name = comm
        .trim()
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    AGENT_PROCESS_NAMES.contains(&name.as_str())
}

#[cfg(unix)]
fn kill(pid: u32) {
    // SAFETY: a plain signal send; an invalid pid just returns ESRCH. The
    // is_orphan_agent check above confirmed the pid is live and one of ours.
    unsafe {
        libc::kill(pid as i32, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
fn is_orphan_agent(_pid: u32) -> bool {
    false
}

#[cfg(not(unix))]
fn kill(_pid: u32) {}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn write_then_sweep_clears_the_file() {
        let dir = tempdir().expect("temp dir");
        let mut pids = BTreeMap::new();
        // A pid that is certainly dead (0 is never a real child) so sweep keeps
        // it untouched but still clears the bookkeeping file.
        pids.insert("run-1".to_owned(), 0);
        write(dir.path(), &pids);
        assert!(file_path(dir.path()).exists());

        sweep(dir.path());
        assert!(
            !file_path(dir.path()).exists(),
            "sweep should remove the active-runs file"
        );
    }

    #[test]
    fn sweep_without_a_file_is_a_noop() {
        let dir = tempdir().expect("temp dir");
        sweep(dir.path()); // must not panic when there's nothing to sweep
    }
}
