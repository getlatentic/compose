//! WASM wrapper for the pure `workspace-index` core.
//!
//! Exposes the *same* index/build + search logic the desktop runs
//! natively to the browser, so the browser no longer needs a parallel
//! TypeScript reimplementation (the old `buildFallbackIndex` /
//! `searchFallbackIndex`).
//!
//! State mirrors the desktop: `buildIndex` caches the content-bearing
//! snapshot in WASM memory — exactly as `src-tauri`'s in-memory
//! `WorkspaceIndexStore` does — and returns the content-free snapshot
//! JSON for the UI. `searchIndex` then searches that cached snapshot.
//! (`IndexedDocument.content` is `skip_serializing`, so the JSON handed
//! to the UI carries no document bodies; the bodies live only in the
//! cached struct, where search reads them.)
//!
//! The JSON wire contract matches the `WorkspaceIndexSnapshot` /
//! `WorkspaceSearchHit` TypeScript types in `src/lib/ipc/indexClient.ts`.

use std::cell::RefCell;
use std::collections::HashMap;

use serde::Deserialize;
use wasm_bindgen::prelude::*;
use workspace_index::{build_snapshot, search_snapshot, IndexedDocument, WorkspaceIndexSnapshot};

thread_local! {
    /// One snapshot per workspace, keyed by workspace id. WASM is single-
    /// threaded, so a `RefCell` is sufficient — no atomics.
    static STORE: RefCell<HashMap<String, WorkspaceIndexSnapshot>> = RefCell::new(HashMap::new());
}

/// `[{docId, path, content}]` from the browser's virtual workspace.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocInput {
    doc_id: String,
    path: String,
    content: String,
}

/// Build the index for `workspace_id` from the virtual-workspace files,
/// cache the content-bearing snapshot, and return the content-free
/// snapshot JSON for the UI. `indexed_at_ms` is the host clock
/// (`Date.now()`) since the core is clock-free.
#[wasm_bindgen(js_name = buildIndex)]
pub fn build_index(
    workspace_id: String,
    docs_json: &str,
    indexed_at_ms: f64,
) -> Result<String, String> {
    let inputs: Vec<DocInput> =
        serde_json::from_str(docs_json).map_err(|error| format!("malformed docs json: {error}"))?;
    let documents = inputs
        .into_iter()
        .map(|doc| IndexedDocument::from_content(doc.doc_id, doc.path, doc.content))
        .collect();
    let snapshot = build_snapshot(workspace_id.clone(), documents, 0, indexed_at_ms as i64);
    let json = serde_json::to_string(&snapshot).map_err(|error| error.to_string())?;
    STORE.with(|store| store.borrow_mut().insert(workspace_id, snapshot));
    Ok(json)
}

/// Search a previously-built index. Returns `[]` if `buildIndex` has not
/// run for this workspace yet (the caller rebuilds, then retries).
#[wasm_bindgen(js_name = searchIndex)]
pub fn search_index(workspace_id: &str, query: &str, limit: usize) -> Result<String, String> {
    STORE.with(|store| {
        let store = store.borrow();
        let Some(snapshot) = store.get(workspace_id) else {
            return Ok("[]".to_owned());
        };
        serde_json::to_string(&search_snapshot(snapshot, query, limit))
            .map_err(|error| error.to_string())
    })
}
