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

/**
 * Whether this build carries an Aptabase app key (the Rust plugin's
 * COMPOSE_APTABASE_KEY), injected at build by Vite's `define`. The frontend gates
 * its anonymous `app_launched` event on this; false in dev / unconfigured builds.
 * The key itself never reaches the frontend — only this boolean.
 */
declare const __APTABASE_CONFIGURED__: boolean;
