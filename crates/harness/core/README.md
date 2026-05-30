# harness-core

The neutral core for driving — or building — an **agent harness**: a
backend that answers a prompt (a CLI agent, a hosted LLM API, …) behind
one interface, independent of any specific tool.

It provides:

- **The `Harness` trait** — `info` / `readiness` / `install` / `run` /
  `credential` / `login`. Object-safe; consumers hold `Box<dyn Harness>`.
- **A normalized event vocabulary** — `RunEvent` (text, thinking, tool
  start/end, suggested edits, activity, lifecycle) plus `ParsedLine` and
  `normalize_process_event`, the skeleton every process-backed adapter
  shares. An adapter's whole job is "parse my CLI's wire format into
  `RunEvent`."
- **A streaming subprocess engine** — `spawn_streaming` + `ProcessEvent`
  + `ProcessHandle` (SIGTERM→SIGKILL cancel) + PATH augmentation so
  Node-based CLIs resolve even from a Finder-launched `.app`.
- **The neutral request/metadata types** — `RunRequest`, `RunTuning`,
  `HarnessInfo`, `HarnessCapabilities`, `CredentialSpec`, … — and the
  shared interactive-login helper `run_login_command`.

This crate knows nothing about any specific backend. Per-CLI adapters
(e.g. `harness-bob`, `harness-claude`, `harness-codex`) depend on it.

Wire shapes derive `Serialize` with stable field names, so any transport
(HTTP/SSE, an IPC channel) emits identical JSON.

## License

Licensed under either of MIT or Apache-2.0 at your option.
