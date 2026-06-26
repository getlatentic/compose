//! The dependency recipe model and Compose's recipe set.
//!
//! Node and uv ship bundled in the app (`bundled_runtime`), so they aren't here:
//! this set is the *optional* local-AI path — Ollama plus its install
//! prerequisites. Each recipe is static data: how to detect a dependency and how
//! to install it. `requires` encodes ordering (CLT → Homebrew → Ollama) so the
//! doctor installs in order and the UI gates rows until prerequisites land.

use serde::Serialize;

/// One bootstrappable dependency: its identity, what it provides, its
/// prerequisites, and the detect/install strategies.
pub struct DependencyRecipe {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub provides: &'static [&'static str],
    pub requires: &'static [&'static str],
    pub requires_admin: bool,
    pub check: CheckSpec,
    pub install: InstallSpec,
}

/// How to detect whether a dependency is already present.
pub enum CheckSpec {
    /// Run `probe` through the user's login shell (so nvm/brew-installed
    /// binaries are visible); present iff it exits 0 and — when `min_version`
    /// is set — its reported version meets the floor.
    LoginShell {
        probe: &'static str,
        min_version: Option<&'static str>,
    },
    /// `xcode-select -p` exit code — CLT binaries aren't on the node PATH.
    XcodeSelectPath,
}

/// How to install a dependency.
pub enum InstallSpec {
    /// `brew install <formula>` plus `brew services start` — a persistent,
    /// auto-starting background server (Ollama), via a user-level launchd agent
    /// (no sudo).
    BrewService(&'static str),
    /// `xcode-select --install` — Apple's own GUI installer; completion is
    /// asynchronous and confirmed by re-running the check.
    XcodeSelect,
    /// The privileged Homebrew bootstrap: a native admin dialog for the
    /// root-only prefix prep, then the unprivileged streamed installer.
    Homebrew,
}

/// Per-dependency status from the readiness "doctor". camelCase to match the
/// TypeScript consumer; mirrors the harness `HarnessReadiness` shape.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub present: bool,
    pub version: Option<String>,
    pub requires_admin: bool,
    pub provides: Vec<String>,
    pub requires: Vec<String>,
    pub error: Option<String>,
}

/// Compose's dependency set. List order is install order: each entry's
/// `requires` names only earlier entries.
pub const RECIPES: &[DependencyRecipe] = &[
    DependencyRecipe {
        id: "xcode-clt",
        name: "Command Line Tools",
        description:
            "Apple's developer tools — provides git and the compilers some assistants and skills need.",
        provides: &["git", "clang", "make"],
        requires: &[],
        requires_admin: false,
        check: CheckSpec::XcodeSelectPath,
        install: InstallSpec::XcodeSelect,
    },
    DependencyRecipe {
        id: "homebrew",
        name: "Homebrew",
        description: "The macOS package manager used to install Ollama, below.",
        provides: &["brew"],
        requires: &["xcode-clt"],
        requires_admin: true,
        check: CheckSpec::LoginShell {
            probe: "brew --version",
            min_version: None,
        },
        install: InstallSpec::Homebrew,
    },
    DependencyRecipe {
        id: "ollama",
        name: "Ollama (local AI)",
        description: "Runs AI models privately on your Mac — no account needed. Models download separately, on demand.",
        provides: &["ollama"],
        requires: &["homebrew"],
        requires_admin: false,
        // `ollama --version` prints connection warnings on stdout when the
        // server is down, so pull just the version number out.
        check: CheckSpec::LoginShell {
            probe: "ollama --version 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | head -1",
            min_version: None,
        },
        install: InstallSpec::BrewService("ollama"),
    },
];

pub fn recipe_by_id(id: &str) -> Option<&'static DependencyRecipe> {
    RECIPES.iter().find(|recipe| recipe.id == id)
}
