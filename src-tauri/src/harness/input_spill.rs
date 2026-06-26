//! Spill a large chat message to a scratch file so the model reads it on demand
//! via the harness `read` tool instead of carrying the whole paste inline in the
//! first turn — which would blow a small (~4K) context window before the model
//! even starts.
//!
//! The harness `read` tool accepts absolute paths outside the run's cwd (the
//! same property the tool-output spill in `agent-harness` relies on), so the
//! file lives in an OS temp dir rather than the user's notes folder. The
//! frontend writes the short inline reference (`chatInputSpill.ts`); this just
//! lands the bytes and hands back the path.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

/// Scratch dir for spilled chat input, mirroring `agent-harness`'s tool-output
/// spill location convention (`temp_dir/<owner>/<kind>`).
fn spill_dir() -> PathBuf {
    std::env::temp_dir().join("compose").join("chat-input")
}

/// Write `text` to a uniquely-named file under the chat-input scratch dir and
/// return its absolute path. `workspace_id` only tags the filename for
/// traceability — the file is outside the workspace (read by absolute path).
pub(crate) fn spill(workspace_id: &str, text: &str) -> Result<String, String> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let dir = spill_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("creating chat-input scratch dir: {e}"))?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let safe_ws: String = workspace_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let path = dir.join(format!("{safe_ws}-{nanos:x}-{n:x}.md"));
    std::fs::write(&path, text).map_err(|e| format!("writing chat-input spill: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Persist a large chat message to a scratch file the model can `read` on demand,
/// returning the absolute path. The frontend calls this only past its size
/// threshold, then sends a short reference in place of the inline text.
#[tauri::command(async)]
pub fn spill_chat_input(workspace_id: String, text: String) -> Result<String, String> {
    spill(&workspace_id, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spill_writes_text_and_returns_a_readable_absolute_path() {
        let body = "a long pasted message\n".repeat(500);
        let path = spill("workspace-abc123", &body).expect("spill ok");
        let p = std::path::Path::new(&path);
        assert!(p.is_absolute(), "absolute so the harness read tool can reach it: {path}");
        assert_eq!(std::fs::read_to_string(p).unwrap(), body);
        assert!(path.contains("workspace-abc123"), "filename tagged with the workspace: {path}");
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn spill_filenames_are_unique() {
        let a = spill("w", "one").unwrap();
        let b = spill("w", "two").unwrap();
        assert_ne!(a, b, "two spills don't collide");
        let _ = std::fs::remove_file(&a);
        let _ = std::fs::remove_file(&b);
    }
}
