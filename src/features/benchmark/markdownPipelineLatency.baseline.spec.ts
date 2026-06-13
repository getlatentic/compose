/**
 * Markdown-pipeline latency baseline — the v1.1 perf target gate.
 *
 * The production-readiness test run on 2026-06-13 found that opening a
 * 1MB markdown file (~164k words) in the editor took **~22 seconds** —
 * three orders of magnitude off the Sublime bar Compose aims for
 * (see `docs/test-runs/2026-06-13-production-readiness.md`). The bottleneck
 * is the markdown→hast pipeline (`renderMarkdownPreview`), which the
 * editor invokes once per file open through a Web Worker.
 *
 * This spec captures the current latency and records it to a committed
 * report so:
 *
 *   1. Future PRs can see the cost of touching the pipeline without
 *      having to run the test pass by hand.
 *   2. The v1.1 perf-work PR can flip {@link V1_1_TARGET_MS} into a hard
 *      assert the moment the bench actually meets it.
 *
 * **The assert is deliberately soft today.** Hard-asserting against the v1.1
 * target right now would break CI on every commit — the target is meant
 * to be a north star, not an immediate gate. We DO sanity-check that the
 * call returns the right shape and produces non-zero output; if it ever
 * starts hanging or returning empty, this spec will catch that.
 *
 * Excluded from `pnpm test` (filename ends in `.baseline.spec.ts`); run
 * explicitly via `pnpm bench:baseline`.
 */

import { writeFileSync } from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { renderMarkdownPreview } from "../../workers/markdownPipeline";
import { buildDocument } from "./documentFixtures";
import { summarize } from "./statistics";

const JSON_PATH = fileURLToPath(
  new URL("../../../docs/benchmarks/markdown-pipeline.json", import.meta.url),
);

/**
 * v1.1 perf target: a 1MB markdown should parse through
 * `renderMarkdownPreview` (markdown→hast + heading/word-count walk) in
 * **under one second**. This is the median, not p95 — we want the typical
 * open to feel instant, not the worst-case.
 *
 * Source of the target: Sublime, Bear, and Obsidian all open a similarly
 * sized markdown in well under a second. Anything slower than ~1s makes
 * the user assume the app crashed. See
 * `docs/test-runs/2026-06-13-production-readiness.md` S0.
 *
 * When the actual median lands below this, flip the soft warn below into
 * a hard `expect(...).toBeLessThan(V1_1_TARGET_MS)` — same line, just
 * remove the `console.warn` branch.
 */
export const V1_1_TARGET_MS = 1000;

describe("markdown-pipeline latency baseline", () => {
  it("captures the 1MB renderMarkdownPreview latency and reports it", async () => {
    const document = buildDocument("xxlarge");

    // Three samples. Each is a full markdown→hast parse + walk; one cold,
    // two warm. The pipeline is dominated by parse cost, which barely
    // benefits from warmup (no shared cache), so even 3 samples are
    // representative.
    const timings = await measureAsync(
      () => renderMarkdownPreview(document.text),
      { warmup: 1, samples: 3 },
    );
    const summary = summarize(timings);

    // Structural sanity: the parse must actually return content. If
    // `renderMarkdownPreview` ever starts returning an empty tree (silent
    // regression) we want to know.
    const result = await renderMarkdownPreview(document.text);
    expect(result.tree.children.length).toBeGreaterThan(0);
    expect(result.meta.wordCount).toBeGreaterThan(0);
    expect(timings.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true);

    // Soft warn against the v1.1 target. When we hit < 1s, this gate
    // becomes a hard assert.
    if (summary.medianMs > V1_1_TARGET_MS) {
      // eslint-disable-next-line no-console
      console.warn(
        `[markdown-pipeline] median ${summary.medianMs.toFixed(1)}ms > ` +
          `v1.1 target ${V1_1_TARGET_MS}ms (${((summary.medianMs / V1_1_TARGET_MS)).toFixed(1)}x slow). ` +
          `Track in docs/benchmarks/markdown-pipeline.json.`,
      );
    }

    const report = {
      capturedAt: new Date().toISOString(),
      machine: { platform: os.platform(), cpuCount: os.cpus().length },
      target: {
        operation: "renderMarkdownPreview",
        fixture: "xxlarge (1 MB markdown, realistic structure)",
        targetMs: V1_1_TARGET_MS,
        why: "Sublime/Bear/Obsidian open a similarly sized markdown in < 1s. " +
          "Anything slower reads as a hang to a non-technical user.",
      },
      measurement: {
        fixtureBytes: document.byteSize,
        fixtureLines: document.lineCount,
        warmup: 1,
        samples: timings.length,
        medianMs: summary.medianMs,
        p95Ms: summary.p95Ms,
        meanMs: summary.meanMs,
        timingsMs: timings,
      },
      verdict: summary.medianMs <= V1_1_TARGET_MS ? "pass" : "regression-vs-target",
    };
    writeFileSync(JSON_PATH, JSON.stringify(report, null, 2) + "\n");
  });
});

/**
 * Async measurement primitive. Times an async `fn` `samples` times after
 * `warmup` untimed runs, awaiting each call so the parse pipeline (which is
 * `Promise<MarkdownPreviewDocument>`) is fully resolved before we stop the
 * clock. The sync sibling lives in `./measure.ts`.
 */
async function measureAsync(
  fn: () => Promise<unknown>,
  opts: { warmup: number; samples: number },
): Promise<number[]> {
  for (let i = 0; i < opts.warmup; i += 1) {
    await fn();
  }
  const out: number[] = [];
  for (let i = 0; i < opts.samples; i += 1) {
    const start = performance.now();
    await fn();
    out.push(performance.now() - start);
  }
  return out;
}
