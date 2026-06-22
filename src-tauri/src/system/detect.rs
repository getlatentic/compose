//! The readiness "doctor": probe each recipe and report whether it's present.
//! Detection is method-agnostic — a Node from nvm or a uv installed by any
//! means satisfies the check, so we never double-install.

use crate::system::recipe::{CheckSpec, DependencyRecipe, DependencyStatus};
use std::process::{Command, Stdio};

/// Probe one recipe into a [`DependencyStatus`].
pub fn detect(recipe: &DependencyRecipe) -> DependencyStatus {
    let (present, version) = match &recipe.check {
        CheckSpec::XcodeSelectPath => detect_xcode(),
        CheckSpec::LoginShell { probe, min_version } => detect_login_shell(probe, *min_version),
    };
    DependencyStatus {
        id: recipe.id.to_owned(),
        name: recipe.name.to_owned(),
        description: recipe.description.to_owned(),
        present,
        version,
        requires_admin: recipe.requires_admin,
        provides: recipe.provides.iter().map(|s| (*s).to_owned()).collect(),
        requires: recipe.requires.iter().map(|s| (*s).to_owned()).collect(),
        error: None,
    }
}

fn detect_xcode() -> (bool, Option<String>) {
    match Command::new("xcode-select")
        .arg("-p")
        .stderr(Stdio::null())
        .output()
    {
        Ok(out) if out.status.success() => {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_owned();
            (true, (!path.is_empty()).then_some(path))
        }
        _ => (false, None),
    }
}

fn detect_login_shell(probe: &str, min_version: Option<&str>) -> (bool, Option<String>) {
    match run_login_shell(probe) {
        Some(raw) => {
            let version = raw.lines().next().unwrap_or_default().trim().to_owned();
            let meets = match min_version {
                Some(min) => semver_at_least(&version, min),
                None => true,
            };
            (meets, (!version.is_empty()).then_some(version))
        }
        None => (false, None),
    }
}

/// Run a one-liner through `$SHELL -l -c` so login-profile PATH entries (nvm,
/// Homebrew) are visible. `None` on non-zero exit or empty output.
fn run_login_shell(command: &str) -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_owned());
    let output = Command::new(&shell)
        .arg("-l")
        .arg("-c")
        .arg(command)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let trimmed = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// `actual >= minimum` for `vX.Y.Z` strings; tolerant of a leading `v` (or any
/// non-digit prefix) and prerelease suffixes.
fn semver_at_least(actual: &str, minimum: &str) -> bool {
    fn parse(raw: &str) -> (u32, u32, u32) {
        let clean = raw
            .trim_start_matches(|c: char| !c.is_ascii_digit())
            .split('-')
            .next()
            .unwrap_or_default();
        let mut parts = clean.split('.').map(|seg| seg.parse::<u32>().unwrap_or(0));
        (
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
        )
    }
    let (a_major, a_minor, a_patch) = parse(actual);
    let (m_major, m_minor, m_patch) = parse(minimum);
    if a_major != m_major {
        return a_major > m_major;
    }
    if a_minor != m_minor {
        return a_minor > m_minor;
    }
    a_patch >= m_patch
}

#[cfg(test)]
mod tests {
    use super::semver_at_least;

    #[test]
    fn meets_floor_with_v_prefix() {
        assert!(semver_at_least("v22.15.0", "22.0.0"));
        assert!(semver_at_least("v24.0.0", "22.0.0"));
    }

    #[test]
    fn below_floor_fails() {
        assert!(!semver_at_least("v18.19.0", "22.0.0"));
        assert!(!semver_at_least("v21.99.99", "22.0.0"));
    }

    #[test]
    fn ignores_prerelease_suffix() {
        assert!(semver_at_least("v22.0.0-nightly", "22.0.0"));
    }
}
