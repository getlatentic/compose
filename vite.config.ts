import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;
const require = createRequire(import.meta.url);
const workerSafeCharacterDecoder = require.resolve("decode-named-character-reference");

// Instrumented build? (react-scan overlay and/or perf marks enabled.) When set
// we tell esbuild to KEEP function/class names through minification — otherwise
// every component is renamed to a 2-letter token (`AX`, `gz`) and react-scan's
// tree + "why did X render" panel is unreadable. Costs a few KB of `__name`
// helpers, so a normal release build (flags unset) stays fully minified.
const instrumented =
  process.env.COMPOSE_REACT_SCAN === "1" || process.env.COMPOSE_PERF === "1";

// react-scan re-render overlay, gated on `COMPOSE_REACT_SCAN=1`.
//
// react-scan must install its reconciler hook BEFORE React evaluates, so
// it has to be the first import in the entry module — a dynamic import
// can't do that (ESM hoists React above runtime code). This plugin
// prepends `import "./reactScanInit"` to `src/main.tsx` ONLY when the
// flag is set. When unset the plugin no-ops, `reactScanInit` is never
// referenced, and react-scan tree-shakes out entirely (zero bytes).
function reactScanInjectPlugin(): Plugin {
  const enabled = process.env.COMPOSE_REACT_SCAN === "1";
  return {
    name: "compose:react-scan-inject",
    enforce: "pre",
    transform(code, id) {
      if (!enabled) return null;
      if (!id.includes("/src/main.tsx")) return null;
      return { code: `import "./reactScanInit";\n${code}`, map: null };
    },
  };
}


// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [reactScanInjectPlugin(), react()],
  // Keep component names readable in react-scan / perf marks for instrumented
  // builds; no effect on a normal release build (see `instrumented` above).
  esbuild: {
    keepNames: instrumented,
  },
  resolve: {
    alias: {
      "decode-named-character-reference": workerSafeCharacterDecoder,
      // `<Profiler>` reports zero in a production react-dom. The profiling
      // build keeps the timers, and costs enough that only a COMPOSE_PERF
      // build gets it.
      ...(process.env.COMPOSE_PERF === "1"
        ? { "react-dom/client": "react-dom/profiling" }
        : {}),
    },
  },
  // Build-time perf gate — symmetric with the Rust-side
  // `COMPOSE_DEVTOOLS` env var. A normal release build replaces this
  // with `false`, so the gated code tree-shakes away and ships zero
  // bytes. See `docs/perf-spec.md` §3.1.
  //
  //   COMPOSE_PERF=1  → `[perf]` console lines + User Timing marks
  //   (react-scan uses the inject plugin above, not a define constant.)
  define: {
    __COMPOSE_PERF__: JSON.stringify(process.env.COMPOSE_PERF === "1"),
  },
  build: {
    // The editor's heavy vendors (CodeMirror, KaTeX) are static dependencies of
    // the entry now, so they load either way; this only decides whether the HTML
    // declares them. Measured both ways over three launches: declaring them made
    // the webview phase 689ms against 655ms — no better, and 2MB more markup for
    // the parser to walk. Left undeclared.
    modulePreload: {
      resolveDependencies(_filename: string, deps: string[]) {
        return deps.filter((dep) => !/(codemirror|katex)-[A-Za-z0-9_]+\.js$/.test(dep));
      },
    },
    // No vendor split. Every eager asset is one more request through Tauri's
    // custom protocol, and each of those measured ~20ms here: six assets put
    // `entry` at 286ms, two put it at 166ms. Splitting react/carbon/codemirror
    // into their own chunks buys cache granularity across deploys, which a
    // desktop app that ships its assets inside the binary has no use for.
    // Dynamic imports still split; only the eager graph is one file.
    //
    // The stylesheet keeps its own request. Inlining it into the HTML was tried
    // and measured worse (entry 171-250ms against 166ms): 430KB of markup ahead
    // of the script tag costs more than the round-trip it saves.
    rollupOptions: {},
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
          port: 1423,
        }
      : undefined,
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
      // Real-browser (WebKit) suites — geometry/caret behavior jsdom can't
      // test. Run via `pnpm test:browser` (vitest.browser.config.ts).
      "**/*.browser.test.ts",
      // Agent worktree mirrors (.claude/worktrees/<name>/src/**) are full
      // copies of the repo; without this, vitest collects every suite a
      // second/third time and the count silently triples.
      "**/.claude/**",
    ],
  },
}));
