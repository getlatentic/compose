import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;
const require = createRequire(import.meta.url);
const workerSafeCharacterDecoder = require.resolve("decode-named-character-reference");

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "decode-named-character-reference": workerSafeCharacterDecoder,
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react";
          }

          if (id.includes("node_modules/hast-util-to-jsx-runtime")) {
            return "markdown";
          }

          return undefined;
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available.
  //
  // Note: 1420 was the original Tauri-default port; we switched to
  // 1421 because port 1420 is occupied by another local app on the
  // dev machine. `pnpm tauri dev` would also need
  // `src-tauri/tauri.conf.json::devUrl` + `connect-src` CSP updated
  // to match — leave that until the Tauri shell is the active
  // target. Browser preview via `pnpm dev` uses 1421 as configured
  // here.
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          // Bumped to 1423 because 1422 is now reserved for the
          // Rust `bob-api` dev server (started by the dev script).
          port: 1423,
        }
      : undefined,
    // Forward every bob endpoint to the Rust `bob-api` server on
    // :1422. Same-origin from the browser's perspective. The
    // handlers all live in Rust (`crates/bob-core`) — same code
    // the Tauri prod build runs through `invoke()`.
    proxy: {
      "/api/bob": "http://127.0.0.1:1422",
    },
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "node",
    globals: true,
    // Benchmark capture specs end in `.baseline.spec.ts` and take 30s+ to
    // run. Excluded from the default `pnpm test`; invoke explicitly via
    // `pnpm bench:baseline` (which passes the file via `--include`).
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/*.baseline.spec.ts",
      // Agent worktree mirrors (.claude/worktrees/<name>/src/**) are full
      // copies of the repo; without this, vitest collects every suite a
      // second/third time and the count silently triples.
      "**/.claude/**",
    ],
  },
}));
