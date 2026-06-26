/// <reference types="vite/client" />

interface ImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Build-time perf gate. Replaced at build by Vite (`vite.config.ts` →
 * `define`) based on the `COMPOSE_PERF=1` env var passed to
 * `pnpm tauri build`. False in normal release builds; the perf
 * functions tree-shake to no-ops when this is false.
 */
declare const __COMPOSE_PERF__: boolean;
