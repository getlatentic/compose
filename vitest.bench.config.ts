import { defineConfig } from "vitest/config";

/**
 * Dedicated config for the lag benchmark (`pnpm bench:baseline`).
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
 * Standalone (no React plugin / aliases): the benchmark imports only pure
 * TS plus the compiled WASM artifact, none of which need them.
 */
export default defineConfig({
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
