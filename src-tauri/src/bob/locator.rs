use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

const BOB_BINARY_NAME: &str = "bob";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BobExecutable {
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BobExecutableError {
    ExplicitPathInvalid(PathBuf),
    NotFound { attempts: Vec<String> },
}

impl std::fmt::Display for BobExecutableError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ExplicitPathInvalid(path) => {
                write!(
                    formatter,
                    "BOB_CLI_PATH does not point to an executable file: {}",
                    path.display()
                )
            }
            Self::NotFound { attempts } => {
                write!(
                    formatter,
                    "Bob CLI was not found. Checked {}",
                    attempts.join(", ")
                )
            }
        }
    }
}

impl std::error::Error for BobExecutableError {}

pub fn resolve_bob_executable() -> Result<BobExecutable, BobExecutableError> {
    resolve_bob_executable_with(
        std::env::var_os("BOB_CLI_PATH"),
        std::env::var_os("PATH"),
        resolve_from_login_shells,
    )
}

fn resolve_bob_executable_with<F>(
    explicit_path: Option<OsString>,
    path_env: Option<OsString>,
    shell_resolver: F,
) -> Result<BobExecutable, BobExecutableError>
where
    F: FnOnce() -> Option<PathBuf>,
{
    if let Some(raw_path) = explicit_path {
        let path = PathBuf::from(raw_path);
        if is_executable_file(&path) {
            return Ok(BobExecutable { path });
        }
        return Err(BobExecutableError::ExplicitPathInvalid(path));
    }

    let mut attempts = vec!["PATH".to_owned()];
    if let Some(path) = find_on_path(path_env.as_ref(), BOB_BINARY_NAME) {
        return Ok(BobExecutable { path });
    }

    attempts.push("login shell".to_owned());
    if let Some(path) = shell_resolver().filter(|path| is_executable_file(path)) {
        return Ok(BobExecutable { path });
    }

    Err(BobExecutableError::NotFound { attempts })
}

fn find_on_path(path_env: Option<&OsString>, binary_name: &str) -> Option<PathBuf> {
    let path_env = path_env?;
    for directory in std::env::split_paths(path_env) {
        let candidate = directory.join(binary_name);
        if is_executable_file(&candidate) {
            return Some(candidate);
        }
    }
    None
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(unix)]
fn resolve_from_login_shells() -> Option<PathBuf> {
    for shell in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        let shell_path = Path::new(shell);
        if !is_executable_file(shell_path) {
            continue;
        }
        let Ok(output) = Command::new(shell_path)
            .arg("-lc")
            .arg("command -v bob")
            .output()
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        if let Some(path) = first_absolute_line(&output.stdout) {
            return Some(path);
        }
    }
    None
}

#[cfg(not(unix))]
fn resolve_from_login_shells() -> Option<PathBuf> {
    None
}

fn first_absolute_line(bytes: &[u8]) -> Option<PathBuf> {
    let output = String::from_utf8_lossy(bytes);
    output
        .lines()
        .map(str::trim)
        .map(PathBuf::from)
        .find(|path| path.is_absolute())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[cfg(unix)]
    fn make_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;

        fs::write(path, "#!/bin/sh\n").expect("write executable");
        let mut permissions = fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("set permissions");
    }

    #[cfg(not(unix))]
    fn make_executable(path: &Path) {
        fs::write(path, "").expect("write executable");
    }

    #[test]
    fn resolves_bob_from_process_path() {
        let dir = tempdir().expect("tempdir");
        let bob = dir.path().join("bob");
        make_executable(&bob);

        let resolved =
            resolve_bob_executable_with(None, Some(dir.path().as_os_str().to_owned()), || None)
                .expect("resolved bob");

        assert_eq!(resolved.path, bob);
    }

    #[test]
    fn resolves_bob_from_login_shell_when_process_path_is_missing_it() {
        let dir = tempdir().expect("tempdir");
        let bob = dir.path().join("bob");
        make_executable(&bob);

        let resolved =
            resolve_bob_executable_with(None, Some(OsString::from("")), || Some(bob.clone()))
                .expect("resolved bob");

        assert_eq!(resolved.path, bob);
    }

    #[test]
    fn rejects_invalid_explicit_bob_path() {
        let missing = PathBuf::from("/tmp/compose-missing-bob");

        let error =
            resolve_bob_executable_with(Some(missing.clone().into_os_string()), None, || None)
                .expect_err("invalid explicit path must fail");

        assert_eq!(error, BobExecutableError::ExplicitPathInvalid(missing));
    }

    #[test]
    fn parses_first_absolute_shell_line() {
        let parsed = first_absolute_line(b"noise\n/Users/dev/bin/bob\n");

        assert_eq!(parsed, Some(PathBuf::from("/Users/dev/bin/bob")));
    }
}
