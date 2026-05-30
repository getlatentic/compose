//! Compose's neutral agent-harness core.
//!
//! The library you depend on to drive — or build — an agent harness,
//! independent of any specific backend. It provides:
//!   * the generic streaming subprocess engine ([`spawn_streaming`] +
//!     [`BobRunEvent`] + [`BobRunHandle`]), and
//!   * the streamed install/login event shape ([`InstallEvent`]).
//!
//! The `Harness` trait, the normalized [`RunEvent`] vocabulary, and the
//! neutral request/metadata types land here too (next commit). Per-CLI
//! adapters (bob/claude/codex) live in their own crates and depend on
//! this one; this crate knows nothing about any specific backend.
//!
//! Wire shapes derive `Serialize` so every transport emits identical
//! JSON — keep their field names stable; the TypeScript front-end
//! consumes them verbatim.

pub mod install;
pub mod process;

pub use install::InstallEvent;
pub use process::{augmented_node_path, spawn_streaming, BobRunEvent, BobRunHandle};
