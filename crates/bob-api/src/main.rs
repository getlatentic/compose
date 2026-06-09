//! Dev HTTP server exposing `bob-rs` to the browser preview.
//!
//! Boots alongside Vite during `pnpm dev` so the browser at
//! `localhost:1421` can reach the same Rust logic that the
//! production Tauri binary uses. Production builds don't run
//! this server — the Tauri runtime calls `bob-rs` directly
//! via `#[tauri::command]`.
//!
//! Endpoints (mirror the Tauri command surface):
//!   * `GET  /api/bob/check`   → readiness snapshot
//!   * `POST /api/bob/install` → SSE stream of install events
//!   * `POST /api/bob/key`     → save key to OS keychain
//!   * `DELETE /api/bob/key`   → delete keychain entry
//!
//! Listens on `127.0.0.1:1422` by default. Vite proxies
//! `/api/bob` traffic over to here (see `vite.config.ts`).

use axum::{
    extract::Json,
    http::StatusCode,
    response::{sse::Event, sse::Sse, IntoResponse},
    routing::{get, post},
    Router,
};
use bob_rs::{
    delete_api_key, get_readiness, install_bob, spawn_bob, write_api_key, BobReadinessSnapshot,
    ProcessEvent, InstallEvent, RunBobOptions,
};
use futures_util::stream::{Stream, StreamExt};
use serde::Deserialize;
use std::{convert::Infallible, net::SocketAddr, time::Duration};
use tokio::sync::mpsc;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

#[tokio::main]
async fn main() {
    // Load `.env` from the workspace root so `BOBSHELL_API_KEY=...`
    // continues to work for devs who set it that way. Production
    // (Tauri build) doesn't run this server and reads the key
    // from the OS keychain only.
    let _ = dotenvy::dotenv();

    // CORS open during dev so the browser at any localhost port
    // can probe us. Vite usually proxies same-origin, but having
    // CORS on means we can also hit the server directly from
    // curl / a different dev port without 4xx-ing.
    let cors = CorsLayer::permissive();

    let app = Router::new()
        .route("/api/bob/check", get(handle_check))
        .route("/api/bob/install", post(handle_install))
        .route("/api/bob/key", post(handle_key_save).delete(handle_key_delete))
        .route("/api/bob/run", post(handle_run))
        .layer(cors);

    // Port choice: 1422. 1421 is Vite. 1420 is occupied on the
    // dev machine per the project docs. Bumping by 1 keeps the
    // dev-server set easy to remember.
    let addr: SocketAddr = "127.0.0.1:1422".parse().unwrap();
    eprintln!("bob-api listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

/// `GET /api/bob/check`
async fn handle_check() -> Json<BobReadinessSnapshot> {
    // `get_readiness()` spawns shells synchronously; doing it on
    // the tokio thread is fine because the calls each take ~50ms
    // and we don't see hammering on this endpoint. If it ever
    // becomes a problem, wrap with `tokio::task::spawn_blocking`.
    Json(get_readiness())
}

/// `POST /api/bob/install` — SSE stream of install progress.
///
/// Each `InstallEvent` becomes an SSE message with the event name
/// derived from the variant tag (`install.step`, `install.stdout`,
/// `install.stderr`, `install.done`). Matches the wire format the
/// existing browser-side `installBob()` generator already parses.
async fn handle_install() -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // Bridge between the blocking `bob_rs::install_bob` callback
    // and axum's async SSE stream via a tokio mpsc channel. The
    // installer runs on a blocking worker so its synchronous I/O
    // doesn't park a tokio runtime thread.
    let (tx, rx) = mpsc::unbounded_channel::<InstallEvent>();

    tokio::task::spawn_blocking(move || {
        let tx_for_callback = tx.clone();
        let _ = install_bob(move |event| {
            // Best-effort send. If the client has disconnected
            // the receiver is dropped and `send` returns Err —
            // we ignore that and let the install run to completion
            // (or get killed by the script wait).
            let _ = tx_for_callback.send(event);
        });
        drop(tx); // close the stream after the install finishes
    });

    // Convert the mpsc receiver into an axum SSE stream. Each
    // message becomes one `event: install.<kind>\ndata: <json>`
    // block over the wire.
    let stream = tokio_stream::wrappers::UnboundedReceiverStream::new(rx)
        .map(|event| {
            let event_name = match &event {
                InstallEvent::Step { .. } => "install.step",
                InstallEvent::Stdout { .. } => "install.stdout",
                InstallEvent::Stderr { .. } => "install.stderr",
                InstallEvent::Done { .. } => "install.done",
            };
            let payload = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_owned());
            Ok(Event::default().event(event_name).data(payload))
        });

    // Initial `ready` event so the browser can show a starting
    // state immediately, matching the existing protocol.
    let prelude = futures_util::stream::once(async {
        Ok(Event::default()
            .event("ready")
            .data(r#"{"startedAt":0}"#))
    });

    Sse::new(prelude.chain(stream)).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    )
}

#[derive(Debug, Deserialize)]
struct KeySaveBody {
    #[serde(rename = "apiKey")]
    api_key: String,
}

/// `POST /api/bob/key`
async fn handle_key_save(Json(body): Json<KeySaveBody>) -> impl IntoResponse {
    let trimmed = body.api_key.trim();
    if trimmed.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Missing `apiKey` string" })),
        );
    }
    match write_api_key(trimmed) {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "ok": true,
                "configured": true,
                "source": "keychain"
            })),
        ),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err.to_string() })),
        ),
    }
}

/// `POST /api/bob/run` — spawn bob and stream JSONL events as SSE.
///
/// Wire format matches the previous Vite-plugin implementation so
/// the existing TypeScript `streamBob()` parser keeps working
/// unchanged:
///   * `event: ready`            `{ runId }`               — handshake
///   * `event: bob.<type>`       `<parsed bob JSON>`       — per stdout line
///     (`bob.init`, `bob.message`, `bob.tool_use`, etc — the `type` field on
///     the JSON line names the SSE event)
///   * `event: bob.stderr`       `{ text }`                — non-JSON stdout or stderr
///   * `event: bob.error`        `{ message }`             — spawn / IO failure
///   * `event: end`              `{ exitCode, runId }`     — terminal
///
/// Cancellation: when the SSE connection closes (browser disconnect),
/// the `ProcessHandle` is dropped on the receiver side, but the spawn
/// thread keeps the handle and `cancel()`s it via the dedicated
/// disconnect arm of the stream. SIGTERM lets bob flush a final
/// answer; SIGKILL fallback in `bob-rs` covers the unrecoverable
/// hang case.
async fn handle_run(Json(opts): Json<RunBobOptions>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let run_id = Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::unbounded_channel::<ProcessEvent>();

    // `spawn_bob` is sync — wrap in spawn_blocking so the spawn
    // step itself doesn't park a tokio worker. The reader/wait
    // threads inside bob-rs are already std::thread, so once
    // the spawn returns they're fully detached.
    let spawn_run_id = run_id.clone();
    let _ = tokio::task::spawn_blocking(move || {
        let cb = {
            let tx = tx.clone();
            move |event: ProcessEvent| {
                let _ = tx.send(event);
            }
        };
        match spawn_bob(opts, spawn_run_id, cb) {
            Ok(_handle) => {
                // Drop tx when the run thread is done — the
                // wait thread inside bob-rs will have sent the
                // terminal `Exited` event already. Closing the
                // channel ends the SSE stream.
                drop(tx);
            }
            Err(err) => {
                let _ = tx.send(ProcessEvent::Error {
                    run_id: String::new(),
                    message: err.to_string(),
                });
                drop(tx);
            }
        }
    })
    .await;

    // Map each ProcessEvent to the wire-shape SSE event the TS
    // client already understands.
    let stream = tokio_stream::wrappers::UnboundedReceiverStream::new(rx).flat_map(|event| {
        let events = map_event_to_sse(event);
        futures_util::stream::iter(events.into_iter().map(Ok))
    });

    // Lead with the synthetic `ready` so the browser shows a
    // thinking state even before bob writes its first line.
    let prelude = futures_util::stream::once({
        let run_id = run_id.clone();
        async move {
            Ok(Event::default()
                .event("ready")
                .data(serde_json::json!({ "runId": run_id }).to_string()))
        }
    });

    Sse::new(prelude.chain(stream)).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    )
}

/// Translate one `ProcessEvent` into one or more SSE `Event`s
/// matching the wire shape the TS client expects. Returns a Vec
/// because `Stdout` events fan out into JSON-typed sub-events.
fn map_event_to_sse(event: ProcessEvent) -> Vec<Event> {
    match event {
        ProcessEvent::Started { .. } => Vec::new(), // already emitted as `ready` prelude
        ProcessEvent::Stdout { line, .. } => {
            // Each bob stdout line is a JSON object with a `type`
            // field. Emit `event: bob.<type>` and pass the parsed
            // object through verbatim — the TS parser uses the
            // event name to dispatch and the data to populate.
            match serde_json::from_str::<serde_json::Value>(&line) {
                Ok(parsed) => {
                    let type_field = parsed
                        .as_object()
                        .and_then(|m| m.get("type"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    vec![Event::default()
                        .event(format!("bob.{type_field}"))
                        .data(parsed.to_string())]
                }
                Err(_) => {
                    // Non-JSON line — surface as stderr so the
                    // client can show it without crashing the
                    // parser.
                    vec![Event::default()
                        .event("bob.stderr")
                        .data(serde_json::json!({ "text": line }).to_string())]
                }
            }
        }
        ProcessEvent::Stderr { line, .. } => vec![Event::default()
            .event("bob.stderr")
            .data(serde_json::json!({ "text": line }).to_string())],
        ProcessEvent::Error { message, .. } => vec![Event::default()
            .event("bob.error")
            .data(serde_json::json!({ "message": message }).to_string())],
        ProcessEvent::Exited { exit_code, run_id, .. } => vec![Event::default()
            .event("end")
            .data(serde_json::json!({ "exitCode": exit_code, "runId": run_id }).to_string())],
        // `ProcessEvent` is `#[non_exhaustive]`; a future engine variant has
        // no SSE wire shape the TS client knows, so emit nothing.
        _ => Vec::new(),
    }
}

/// `DELETE /api/bob/key`
async fn handle_key_delete() -> impl IntoResponse {
    match delete_api_key() {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err.to_string() })),
        ),
    }
}
