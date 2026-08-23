//! Optional local-AI tooling: detect what's on the machine and, for anything
//! missing, hand the user to the official download (`InstallHint`) — the same
//! contract agents get. Compose discovers and runs local tools; it never
//! installs them, so there is no installer, no elevation, and no bundled
//! runtime here.

pub mod commands;
mod detect;
mod recipe;
