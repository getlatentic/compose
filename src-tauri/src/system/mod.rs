//! System dependency bootstrap: detect and install the developer tooling the AI
//! assistants and skills need (Xcode Command Line Tools, Homebrew, Node, uv).
//!
//! Mirrors the [`harness`](crate::harness) module's shape — a static recipe
//! registry, a readiness "doctor", and a streamed installer — and reuses the
//! same `InstallEvent` wire vocabulary so the front-end consumes both with one
//! code path. The privileged steps (Homebrew's prefix) go through
//! [`elevate`]'s native macOS auth dialog.

pub mod commands;
mod detect;
mod elevate;
mod install;
mod recipe;
