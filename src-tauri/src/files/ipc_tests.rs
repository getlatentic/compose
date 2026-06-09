//! IPC-contract tests for `workspace_write_binary_file`.
//!
//! The helper unit tests in `mod.rs` call the `pub(crate)` functions directly.
//! These instead drive the real `#[tauri::command]` through Tauri's IPC router
//! via `tauri::test`, so they exercise the boundary the front end actually
//! crosses in the packaged app — the parts that unit tests and `cargo check`
//! can't see:
//!
//!   * the command is a valid, dispatchable `#[tauri::command]` that survives
//!     IPC routing and the ACL (not a "command not found" / "not allowed"
//!     rejection);
//!   * camelCase → snake_case argument deserialization (`workspaceId` →
//!     `workspace_id`, `relativePath` → `relative_path`); and
//!   * the byte payload shape the image-insert pipeline sends — `filesClient`
//!     does `Array.from(bytes)`, i.e. a JSON number array, which must decode
//!     back into `Vec<u8>` byte-for-byte.
//!
//! What this does *not* cover: that `lib.rs`'s `invoke_handler!` lists the
//! command. The shipping list binds `Wry`, while `get_ipc_response` requires
//! `MockRuntime`, so the two can't share a registration here; that linkage
//! rests on the `generate_handler!` compile in `lib.rs`.

use crate::db::MetadataStore;
use crate::workspace::WorkspaceRegistry;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::utils::acl::ExecutionContext;
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};
use tempfile::TempDir;

/// The IPC command name under test, as the front end invokes it.
const COMMAND: &str = "workspace_write_binary_file";

/// The webview origin a local IPC call carries, per platform. The app's
/// capability is `local`-scoped, so the origin has to match for the ACL to
/// permit the command — using the wrong one reproduces the "not allowed"
/// rejection rather than testing the command.
fn local_origin() -> &'static str {
    if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
}

/// Build a mock Tauri app with a real on-disk workspace registered and the
/// metadata store initialised, wired with only the binary-write command. The
/// returned tempdirs must be kept alive for the duration of the test (they own
/// the workspace + metadata directories).
fn mock_app() -> (TempDir, TempDir, App<MockRuntime>, String) {
    let workspace_dir = TempDir::new().expect("workspace dir");
    let data_dir = TempDir::new().expect("metadata dir");

    let registry = WorkspaceRegistry::default();
    let workspace_id = registry
        .add(workspace_dir.path().to_string_lossy().to_string())
        .expect("register workspace")
        .workspaces[0]
        .id
        .clone();

    let metadata = MetadataStore::default();
    metadata
        .init_from_dir(data_dir.path())
        .expect("init metadata");

    // `mock_context` ships an empty ACL (`Resolved::default()`), so even app
    // commands are rejected at the boundary with "not allowed. Plugin not
    // found". The real `generate_context!` (which resolves the shipping
    // capabilities) can only be expanded once per crate, and `lib.rs` already
    // owns that expansion — so we grant just this command on the test
    // authority, the `tauri::test` seam intended for exactly this.
    let mut context = mock_context(noop_assets());
    context
        .runtime_authority_mut()
        .__allow_command(COMMAND.to_string(), ExecutionContext::Local);

    // Only this command is registered: the rest of the shipping handler set
    // binds `AppHandle`/`Channel` to the concrete `Wry` runtime and cannot be
    // hosted on the `MockRuntime` that `get_ipc_response` requires. So this
    // proves the command's IPC contract (routing, arg decoding, payload shape),
    // not its membership in `lib.rs`'s `invoke_handler!` — that linkage is a
    // compile-time guarantee of `generate_handler!` there.
    let app = mock_builder()
        .manage(registry)
        .manage(metadata)
        .invoke_handler(tauri::generate_handler![
            crate::files::workspace_write_binary_file
        ])
        .build(context)
        .expect("build mock app");

    (workspace_dir, data_dir, app, workspace_id)
}

fn webview(app: &App<MockRuntime>) -> WebviewWindow<MockRuntime> {
    WebviewWindowBuilder::new(app, "main", Default::default())
        .build()
        .expect("build webview")
}

fn invoke(cmd: &str, body: serde_json::Value) -> InvokeRequest {
    InvokeRequest {
        cmd: cmd.to_owned(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: local_origin().parse().unwrap(),
        body: InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    }
}

#[test]
fn write_binary_file_command_round_trips_bytes_through_ipc() {
    let (workspace_dir, _data_dir, app, workspace_id) = mock_app();
    let webview = webview(&app);

    // Non-UTF-8 image bytes (PNG magic + raw bytes). The front end serializes
    // these as a JSON number array via `Array.from(bytes)`.
    let bytes: Vec<u8> = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x00, 0xFF, 0x93, 0x96];

    let response = get_ipc_response(
        &webview,
        // camelCase keys exactly as `filesClient.writeBinaryFile` sends them.
        invoke(
            COMMAND,
            serde_json::json!({
                "workspaceId": workspace_id,
                "relativePath": "images/pasted.png",
                "bytes": bytes,
            }),
        ),
    )
    .expect("command must resolve over IPC and succeed");

    // The command returns `WorkspaceWriteResult { lastModifiedMs }` (camelCase).
    let value: serde_json::Value = response.deserialize().expect("deserialize result");
    let mtime = value
        .get("lastModifiedMs")
        .and_then(serde_json::Value::as_i64)
        .expect("result carries lastModifiedMs");
    assert!(mtime > 0, "expected a real mtime, got {mtime}");

    // Parent dir `images/` was created and the bytes survived the round trip.
    let written = std::fs::read(workspace_dir.path().join("images/pasted.png"))
        .expect("image written to disk");
    assert_eq!(written, bytes, "bytes must be identical after the IPC round trip");
}

#[test]
fn write_binary_file_command_rejects_path_traversal_over_ipc() {
    let (workspace_dir, _data_dir, app, workspace_id) = mock_app();
    let webview = webview(&app);

    let result = get_ipc_response(
        &webview,
        invoke(
            COMMAND,
            serde_json::json!({
                "workspaceId": workspace_id,
                "relativePath": "../escape.png",
                "bytes": [1, 2, 3],
            }),
        ),
    );

    // It must be rejected by the *command's own* `FileError`, not by a routing
    // ("Command … not found") or ACL ("not allowed") miss — those are bare
    // string errors, whereas a `FileError` serializes to a tagged object. This
    // keeps the test from passing for the wrong reason if the command is ever
    // unregistered: an unrouted command also errors, but with a string, so the
    // `kind` assertion below fails.
    let error = result.expect_err("traversal must be rejected at the boundary");
    assert_eq!(
        error.get("kind").and_then(serde_json::Value::as_str),
        Some("message"),
        "expected a structured FileError from path sanitization, got {error:?}"
    );
    let escaped = workspace_dir
        .path()
        .parent()
        .expect("workspace has a parent")
        .join("escape.png");
    assert!(!escaped.exists(), "traversal target must never be written");
}
