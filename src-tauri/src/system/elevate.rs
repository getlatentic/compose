//! macOS privilege escalation via `osascript … with administrator privileges`.
//!
//! Shows the native authentication dialog and runs a command as root — used
//! only for the root-only prep a few installers need (Homebrew's prefix). Lives
//! in Compose, not the neutral subprocess engine, because admin-dialog policy
//! is Compose-specific.

use std::process::Command;

/// Result of a privileged run. `user_cancelled` separates the user clicking
/// Cancel on the auth dialog (AppleScript error -128) from a real failure, so
/// the UI can show a neutral "no changes were made" instead of an error.
pub struct AdminOutcome {
    pub exit_code: Option<i32>,
    pub stderr: String,
    pub user_cancelled: bool,
}

/// Run `command` as root behind the native auth dialog, labelled with `prompt`.
/// The whole command runs as root, so callers must keep these to fixed,
/// root-only prep — never user input (see [`applescript_quote`]).
pub fn run_admin(command: &str, prompt: &str) -> AdminOutcome {
    let script = format!(
        "do shell script {} with administrator privileges with prompt {}",
        applescript_quote(command),
        applescript_quote(prompt),
    );
    match Command::new("osascript").arg("-e").arg(&script).output() {
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            let user_cancelled = !out.status.success() && is_user_cancel(&stderr);
            AdminOutcome {
                exit_code: out.status.code(),
                stderr,
                user_cancelled,
            }
        }
        Err(err) => AdminOutcome {
            exit_code: None,
            stderr: err.to_string(),
            user_cancelled: false,
        },
    }
}

fn is_user_cancel(stderr: &str) -> bool {
    stderr.contains("-128") || stderr.contains("User canceled") || stderr.contains("User cancelled")
}

/// Quote a string as an AppleScript string literal. AppleScript escapes only
/// `\` and `"`; everything else (including shell metacharacters like `$` and
/// backticks) passes through to the `/bin/sh` that `do shell script` invokes —
/// which is exactly why `command` must never contain untrusted input.
pub fn applescript_quote(value: &str) -> String {
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    for ch in value.chars() {
        match ch {
            '\\' => quoted.push_str("\\\\"),
            '"' => quoted.push_str("\\\""),
            other => quoted.push(other),
        }
    }
    quoted.push('"');
    quoted
}

#[cfg(test)]
mod tests {
    use super::applescript_quote;

    #[test]
    fn wraps_plain_text_in_quotes() {
        assert_eq!(applescript_quote("echo hi"), r#""echo hi""#);
    }

    #[test]
    fn escapes_embedded_double_quotes() {
        assert_eq!(applescript_quote(r#"say "hi""#), r#""say \"hi\"""#);
    }

    #[test]
    fn escapes_backslashes() {
        assert_eq!(applescript_quote(r"a\b"), r#""a\\b""#);
    }

    #[test]
    fn passes_shell_metacharacters_through() {
        let input = r#"U="$(stat -f %Su /dev/console)""#;
        assert_eq!(
            applescript_quote(input),
            r#""U=\"$(stat -f %Su /dev/console)\"""#
        );
    }
}
