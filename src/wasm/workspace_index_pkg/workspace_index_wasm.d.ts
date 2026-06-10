/* tslint:disable */
/* eslint-disable */

/**
 * Build the index for `workspace_id` from the virtual-workspace files,
 * cache the content-bearing snapshot, and return the content-free
 * snapshot JSON for the UI. `indexed_at_ms` is the host clock
 * (`Date.now()`) since the core is clock-free.
 */
export function buildIndex(workspace_id: string, docs_json: string, indexed_at_ms: number): string;

/**
 * Search a previously-built index. Returns `[]` if `buildIndex` has not
 * run for this workspace yet (the caller rebuilds, then retries).
 */
export function searchIndex(workspace_id: string, query: string, limit: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly buildIndex: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly searchIndex: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
