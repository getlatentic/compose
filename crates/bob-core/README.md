# bob-core

An unofficial, standalone Rust SDK for the **bob** agent CLI: detection
and readiness probing, streaming install, OS-keychain credential storage,
and spawning a `bob` run with its `--output-format stream-json` stream
piped back line-by-line.

No Tauri, no HTTP server, no harness abstraction — just the bob
integration logic, so it can be reused by any host. Building bob behind a
neutral `Harness` interface lives in the separate `harness-bob` crate;
this crate stays a clean SDK.

Key surface:

- `get_readiness()` → a `BobReadinessSnapshot` (installed? version? Node?
  auth configured?).
- `install_bob(cb)` → streams the bundled install script's progress.
- `spawn_bob(opts, run_id, cb)` / `spawn_bob_raw(...)` → spawn a run,
  streaming `ProcessEvent`s (from `harness-core`'s engine) until exit;
  returns a `ProcessHandle` for cancellation.
- `read_api_key` / `write_api_key` / `resolve_api_key` → the bob API key
  in the OS keychain.

## License

Licensed under either of MIT or Apache-2.0 at your option.
