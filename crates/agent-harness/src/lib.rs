//! Compose's neutral agent-harness core.
//!
//! The library you depend on to drive — or build — an agent harness,
//! independent of any specific backend. It provides:
//!   * the [`Harness`] trait + the neutral request/metadata types
//!     ([`RunRequest`] / [`RunTuning`] / [`HarnessInfo`] / …),
//!   * the normalized [`RunEvent`] vocabulary every adapter parses into
//!     ([`normalize_process_event`] + [`ParsedLine`]),
//!   * the generic streaming subprocess engine ([`spawn_streaming`] +
//!     [`ProcessEvent`] + [`ProcessHandle`]) + the install/login event
//!     shape ([`InstallEvent`]), and
//!   * the shared interactive-login helper ([`run_login_command`]).
//!
//! Per-CLI adapters (bob/claude/codex) live in their own crates and
//! depend on this one; this crate knows nothing about any specific
//! backend.
//!
//! Wire shapes derive `Serialize` so every transport emits identical
//! JSON — keep their field names stable; the TypeScript front-end
//! consumes them verbatim.

pub mod events;
pub mod harness;

pub use events::{
    normalize_process_event, ByteRange, ParsedLine, RunEvent, SuggestedEdit, ToolCallEnd,
    ToolCallStart,
};
pub use harness::{
    run_login_command, CredentialSpec, Harness, HarnessCapabilities, HarnessInfo, HarnessModel,
    HarnessReadiness, InstallCallback, ReasoningEffort, RunCallback, RunControl, RunHandle, RunMode,
    RunRequest, RunTuning,
};
// The generic subprocess engine + the install/process event shapes live in
// the `cli-stream` leaf; re-export them so adapters + consumers reach them
// through the framework (e.g. `use harness::spawn_streaming`).
pub use cli_stream::{
    augmented_node_path, spawn_streaming, InstallEvent, ProcessEvent, ProcessHandle,
};
