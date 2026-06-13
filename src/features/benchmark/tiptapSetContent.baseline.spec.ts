/**
 * Tiptap setContent latency baseline.
 *
 * The pipeline-side `markdownPipelineLatency.baseline.spec.ts` shows the
 * worker preview metadata is now ~20ms on 1MB. The remaining ~19s of the
 * 22s editor open observed in the production-readiness test
 * (see `docs/test-runs/2026-06-13-production-readiness.md`) lives in
 * Tiptap's `setContent` — specifically the markdown → ProseMirror walk
 * inside `@tiptap/markdown`.
 *
 * The cost scales super-linearly with document size: under jsdom a 1MB
 * markdown setContent takes 30–50 seconds per sample. So this spec does
 * NOT run the 1MB case (it would blow past vitest's per-test timeout
 * even with one sample). Instead we measure a series of progressively
 * larger fixtures so any perf work — chunked setContent, custom direct-
 * to-PM-nodes parser, virtualized NodeViews — can show its slope by
 * watching the curve flatten across sizes, not just one number.
 *
 * Excluded from `pnpm test` (filename `.baseline.spec.ts`). Runs via
 * `pnpm bench:baseline` in jsdom — the editor needs a DOM to mount.
 */

// @vitest-environment jsdom

import { writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { marked } from "marked";

import { buildDocument, type DocumentSizeLabel } from "./documentFixtures";
import { summarize } from "./statistics";

const JSON_PATH = path.join(
  process.cwd(),
  "docs",
  "benchmarks",
  "tiptap-set-content.json",
);

/**
 * Sizes we measure. Capped at `large` (~300KB) because `xxlarge` (1MB)
 * exceeds vitest's max test timeout in jsdom — a 1MB Tiptap setContent
 * takes 30+ seconds per sample under jsdom and we run multiple samples
 * per size. We grow this once setContent is fast enough to fit.
 */
const SIZES: DocumentSizeLabel[] = ["small", "large"];

describe("tiptap setContent latency baseline", () => {
  it(
    "captures setContent timings per size in markdown and html modes",
    { timeout: 600_000 },
    () => {
      const measurements = SIZES.map((label) => {
        const document_ = buildDocument(label);
        const html = marked.parse(document_.text) as string;

        const markdownTimings = runSamples(() => {
          const editor = makeEditor();
          const t = performance.now();
          editor.commands.setContent(document_.text, { contentType: "markdown" });
          const elapsed = performance.now() - t;
          editor.destroy();
          return elapsed;
        });

        const htmlTimings = runSamples(() => {
          const editor = makeEditor();
          const t = performance.now();
          editor.commands.setContent(html, { contentType: "html" });
          const elapsed = performance.now() - t;
          editor.destroy();
          return elapsed;
        });

        return {
          label,
          bytes: document_.byteSize,
          lines: document_.lineCount,
          htmlBytes: html.length,
          markdown: { ...summarize(markdownTimings), timingsMs: markdownTimings },
          html: { ...summarize(htmlTimings), timingsMs: htmlTimings },
        };
      });

      // Structural sanity — every sample must complete with a positive number.
      for (const m of measurements) {
        expect(m.markdown.timingsMs.every((ms) => Number.isFinite(ms) && ms > 0)).toBe(true);
        expect(m.html.timingsMs.every((ms) => Number.isFinite(ms) && ms > 0)).toBe(true);
      }

      const report = {
        capturedAt: new Date().toISOString(),
        machine: { platform: os.platform(), cpuCount: os.cpus().length },
        target: {
          endToEndOpenTargetMs: 1000,
          why: "Per docs/editor-guide.md — Sublime opens 1MB markdown in < 1s; " +
            "this spec tracks the dominant cost in our editor (Tiptap setContent) " +
            "toward that same end-to-end target. 1MB itself is currently > 30s in " +
            "jsdom so we measure a scaling series rather than a single number.",
        },
        measurements,
      };
      writeFileSync(JSON_PATH, JSON.stringify(report, null, 2) + "\n");
    },
  );
});

const SAMPLES = 3;

function runSamples(timed: () => number): number[] {
  timed(); // warmup
  const out: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    out.push(timed());
  }
  return out;
}

function makeEditor(): Editor {
  return new Editor({
    element: document.body,
    extensions: [StarterKit, Markdown],
    content: "",
  });
}
