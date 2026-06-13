import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

/**
 * Dedicated config for the lag + perf benchmarks (`pnpm bench:baseline`).
 *
 * The default `pnpm test` (vite.config.ts) *excludes* `*.baseline.spec.ts`
 * because the capture takes tens of seconds; this config *includes* only
 * those specs and gives them what a wall-clock benchmark needs:
 *
 *   * a single fork, no file/test parallelism — concurrent work perturbs
 *     timings, so measurements run strictly serially; and
 *   * a long timeout — a single uncached keystroke burst on the largest
 *     document runs well past vitest's 5s default.
 *
 * Resolves `decode-named-character-reference` the same way the main vite
 * config does — needed by the marked / @tiptap/markdown deps that the new
 * `tiptapSetContent.baseline.spec.ts` pulls in. Without this, those imports
 * resolve to the package's bundled-only entry and Vite errors.
 *
 * Per-file env: most baseline specs run in "node"; the Tiptap one declares
 * `// @vitest-environment jsdom` at the top of the file so it gets a DOM.
 */
const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: {
      "decode-named-character-reference": require.resolve("decode-named-character-reference"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.baseline.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 300_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
