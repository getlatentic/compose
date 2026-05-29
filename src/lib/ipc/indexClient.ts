import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import { readFile, scanWorkspace } from "./filesClient";

// Type-only import — erased at runtime, so it adds no static dependency.
// The WASM module is loaded lazily via dynamic import (browser branch
// only), which keeps the ~217 KB artifact out of the desktop bundle.
type WorkspaceIndexWasm = typeof import("../../wasm/workspace_index_pkg/workspace_index_wasm.js");

export interface IndexSourceRange {
  start: number;
  end: number;
}

export type WorkspaceLinkKind = "markdown" | "wikilink";
export type WorkspaceTagKind = "frontmatter" | "inline";

export interface WorkspaceIndexedDocument {
  contentHash: string;
  docId: string;
  path: string;
  title: string;
}

export interface WorkspaceBacklinkRecord {
  kind: WorkspaceLinkKind;
  label: string;
  sourceDocId: string;
  sourcePath: string;
  sourceRange: IndexSourceRange;
  targetDocId: string | null;
  targetPath: string;
}

export interface WorkspaceGraphEdgeRecord {
  fromDocId: string;
  fromPath: string;
  kind: WorkspaceLinkKind;
  sourceRange: IndexSourceRange;
  toDocId: string | null;
  toPath: string;
}

export interface WorkspaceTagRecord {
  docId: string;
  kind: WorkspaceTagKind;
  path: string;
  sourceRange: IndexSourceRange;
  tag: string;
}

export interface WorkspaceFrontmatterRecord {
  docId: string;
  key: string;
  path: string;
  sourceRange: IndexSourceRange;
  value: string;
}

export interface WorkspaceIndexSnapshot {
  backlinks: WorkspaceBacklinkRecord[];
  documents: WorkspaceIndexedDocument[];
  durationMs: number;
  frontmatter: WorkspaceFrontmatterRecord[];
  graphEdges: WorkspaceGraphEdgeRecord[];
  indexedAtMs: number;
  indexedDocumentCount: number;
  tags: WorkspaceTagRecord[];
  workspaceId: string;
}

export interface WorkspaceSearchHit {
  docId: string;
  path: string;
  ranges: IndexSourceRange[];
  score: number;
  snippet: string;
  title: string;
}

export async function rebuildWorkspaceIndex(
  workspaceId: string,
): Promise<WorkspaceIndexSnapshot> {
  if (!isTauriRuntime()) {
    return browserRebuildIndex(workspaceId);
  }
  return invoke<WorkspaceIndexSnapshot>("workspace_rebuild_index", { workspaceId });
}

export async function loadWorkspaceIndexSnapshot(
  workspaceId: string,
): Promise<WorkspaceIndexSnapshot | null> {
  if (!isTauriRuntime()) {
    return browserSnapshots.get(workspaceId) ?? browserRebuildIndex(workspaceId);
  }
  return invoke<WorkspaceIndexSnapshot | null>("workspace_index_snapshot", { workspaceId });
}

export async function searchWorkspaceIndex(
  workspaceId: string,
  query: string,
  limit = 20,
): Promise<WorkspaceSearchHit[]> {
  if (!query.trim()) {
    return [];
  }
  if (!isTauriRuntime()) {
    return browserSearchIndex(workspaceId, query, limit);
  }
  return invoke<WorkspaceSearchHit[]>("workspace_search_index", {
    limit,
    query,
    workspaceId,
  });
}

// ---------------------------------------------------------------------------
// Browser path.
//
// In the browser (no Tauri) the index/search logic is NOT reimplemented in
// TypeScript — it's the same Rust `workspace-index` core the desktop runs,
// compiled to WASM (`workspace_index_pkg`). We feed it the virtual
// workspace's file contents and it builds + searches; this module only
// orchestrates and caches, exactly mirroring the desktop split where the
// Tauri command scans disk and the in-memory store caches the snapshot.
// ---------------------------------------------------------------------------

let wasmModule: Promise<WorkspaceIndexWasm> | null = null;

/**
 * Browser-only: dynamically import + initialise the WASM index on first
 * use. The dynamic import is what code-splits the module out of the
 * desktop bundle — the desktop path indexes via the Tauri command and
 * never touches this.
 */
function loadWasmIndex(): Promise<WorkspaceIndexWasm> {
  if (!wasmModule) {
    wasmModule = import("../../wasm/workspace_index_pkg/workspace_index_wasm.js").then(
      async (mod) => {
        await mod.default();
        return mod;
      },
    );
  }
  return wasmModule;
}

/**
 * Last snapshot per workspace, mirroring the desktop store. The
 * content-bearing index lives inside WASM memory (built by `buildIndex`,
 * searched by `searchIndex`); this map only holds the content-free
 * snapshot the UI consumes, so `loadWorkspaceIndexSnapshot` is cheap.
 */
const browserSnapshots = new Map<string, WorkspaceIndexSnapshot>();

async function collectVirtualDocuments(
  workspaceId: string,
): Promise<{ docId: string; path: string; content: string }[]> {
  const entries = await scanWorkspace(workspaceId);
  const documents: { docId: string; path: string; content: string }[] = [];
  for (const entry of entries) {
    const file = await readFile(workspaceId, entry.relativePath);
    documents.push({
      content: file.content,
      docId: `${workspaceId}:${entry.relativePath}`,
      path: entry.relativePath,
    });
  }
  return documents;
}

async function browserRebuildIndex(workspaceId: string): Promise<WorkspaceIndexSnapshot> {
  const wasm = await loadWasmIndex();
  const documents = await collectVirtualDocuments(workspaceId);
  const started = performance.now();
  const snapshot = JSON.parse(
    wasm.buildIndex(workspaceId, JSON.stringify(documents), Date.now()),
  ) as WorkspaceIndexSnapshot;
  snapshot.durationMs = Math.round(performance.now() - started);
  browserSnapshots.set(workspaceId, snapshot);
  return snapshot;
}

async function browserSearchIndex(
  workspaceId: string,
  query: string,
  limit: number,
): Promise<WorkspaceSearchHit[]> {
  const wasm = await loadWasmIndex();
  if (!browserSnapshots.has(workspaceId)) {
    await browserRebuildIndex(workspaceId);
  }
  return JSON.parse(wasm.searchIndex(workspaceId, query, limit)) as WorkspaceSearchHit[];
}
