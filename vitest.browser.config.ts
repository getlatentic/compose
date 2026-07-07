/**
 * Real-browser test tier (ADR 0001 §Testing): geometry, caret, click placement,
 * and contenteditable behavior run in actual WebKit — the engine Compose ships
 * on — because jsdom has no layout engine and silently green-lights all of it.
 *
 * Suites end in `.browser.test.ts` (excluded from the default jsdom/node run in
 * vite.config.ts). Run: `pnpm test:browser`. Chromium joins when Windows ships.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  optimizeDeps: { include: ["@amiceli/vitest-cucumber"] },
  test: {
    include: ["**/*.browser.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: "webkit" }],
    },
  },
});
