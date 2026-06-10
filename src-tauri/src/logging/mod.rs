//! Local error log — a single append-only file the user can attach to a bug
//! report. **Local-first: it never leaves the machine** (no telemetry, no
//! network), so it needs no consent. It captures:
//!
//! - uncaught front-end errors / promise rejections (`report_client_error`),
//! - failed agent runs (reported from the chat store), and
//! - back-end panics (a panic hook installed at launch).
//!
//! Growth is bounded: the file is trimmed to its tail past [`MAX_LOG_BYTES`].

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// Trim the log once it grows past this; keep the most-recent half.
const MAX_LOG_BYTES: u64 = 512 * 1024;

/// `<app-data>/logs/errors.log`.
pub fn error_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("logs");
    Ok(dir.join("errors.log"))
}

/// Milliseconds since the Unix epoch (the log's timestamp).
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Append one bounded line: `[<ts_ms>] <kind>: <message> | <detail>`.
pub fn append_error_line(
    path: &Path,
    kind: &str,
    message: &str,
    detail: Option<&str>,
    ts_ms: i64,
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() > MAX_LOG_BYTES {
            trim_to_tail(path, MAX_LOG_BYTES / 2)?;
        }
    }
    let detail = detail
        .map(|value| format!(" | {}", value.replace('\n', " ")))
        .unwrap_or_default();
    let message = message.replace('\n', " ");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "[{ts_ms}] {kind}: {message}{detail}")
}

/// Rewrite the file keeping only its last `keep_bytes`, aligned to a line.
fn trim_to_tail(path: &Path, keep_bytes: u64) -> std::io::Result<()> {
    let content = std::fs::read(path)?;
    let mut start = content.len().saturating_sub(keep_bytes as usize);
    if let Some(offset) = content[start..].iter().position(|&byte| byte == b'\n') {
        start += offset + 1;
    }
    std::fs::write(path, &content[start..])
}

/// Record an error reported by the front end (uncaught error, rejection, or a
/// failed agent run).
#[tauri::command(async)]
pub fn report_client_error(
    app: AppHandle,
    kind: String,
    message: String,
    detail: Option<String>,
) -> Result<(), String> {
    let path = error_log_path(&app)?;
    append_error_line(&path, &kind, &message, detail.as_deref(), now_ms())
        .map_err(|error| error.to_string())
}

/// Return the error-log path (creating it if needed) so the UI can reveal it.
#[tauri::command(async)]
pub fn open_error_log(app: AppHandle) -> Result<String, String> {
    let path = error_log_path(&app)?;
    if !path.exists() {
        append_error_line(&path, "info", "error log created", None, now_ms())
            .map_err(|error| error.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn appends_lines_and_trims_to_the_tail() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("logs/errors.log");
        // Write well past the cap so a trim happens.
        let big = "x".repeat(2000);
        for i in 0..400 {
            append_error_line(&path, "uncaught", &format!("err {i} {big}"), None, i).unwrap();
        }
        let meta = std::fs::metadata(&path).unwrap();
        assert!(meta.len() <= MAX_LOG_BYTES, "log must stay bounded");
        let content = std::fs::read_to_string(&path).unwrap();
        // The most-recent line survives; the file starts on a clean line.
        assert!(content.contains("err 399"));
        assert!(content.starts_with('['), "trim must align to a line start");
    }

    #[test]
    fn newlines_in_a_message_stay_on_one_line() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("errors.log");
        append_error_line(&path, "panic", "line1\nline2", Some("a\nb"), 1).unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert_eq!(content.lines().count(), 1);
        assert!(content.contains("line1 line2"));
    }
}
