/**
 * Per-keystroke editor latency baseline — the "feels like Sublime" number.
 *
 * Measures a single-character insert dispatched into a mounted CM6 editor
 * with the production decoration stack: document update + plugin/decoration
 * recompute, i.e. everything on the keystroke path except the final paint
 * (jsdom has no layout). The #70 budget is p50 ≤ 8ms / p95 ≤ 16.7ms — one
 * 60Hz frame with headroom for WebKit's paint slice.
 *
 * Sizes span 256B → 1MB to assert the property that makes the budget
 * holdable at all: CM6 virtualises the viewport, so keystroke cost must be
 * O(viewport), not O(document). A regression that couples typing cost to
 * document size shows up here as the xxlarge row leaving the others.
 *
 * The hard gate is deliberately looser (median < 50ms) so CI machine noise
 * can't flake it; the real budget verdict is recorded in the JSON report
 * (docs/benchmarks/typing-latency.json) for PERF.md to cite.
 *
 * Excluded from `pnpm test` (filename `.baseline.spec.ts`). Runs via
 * `pnpm bench:baseline` in jsdom.
 */

// @vitest-environment jsdom

import { writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { markdownDecorationsPlugin } from "ai-editor";
import { buildDocument, type DocumentSizeLabel } from "./documentFixtures";
import { summarize } from "./statistics";

const JSON_PATH = path.join(process.cwd(), "docs", "benchmarks", "typing-latency.json");

const SIZES: DocumentSizeLabel[] = ["small", "large", "xxlarge"];

/** The #70 budget for the keystroke path (reported, not hard-asserted). */
const BUDGET_P50_MS = 8;
const BUDGET_P95_MS = 16.7;
/** CI-safe hard gate: an order of magnitude past budget = a real regression. */
const HARD_GATE_MEDIAN_MS = 50;

const WARMUP_KEYSTROKES = 20;
const TIMED_KEYSTROKES = 120;

describe("typing latency baseline", () => {
  it(
    "captures per-keystroke dispatch timings per document size",
    { timeout: 600_000 },
    () => {
      const measurements = SIZES.map((label) => {
        const document_ = buildDocument(label);
        const view = mountWithDoc(document_.text);
        // Type mid-document — inside real content, away from the doc edges'
        // degenerate parse states.
        let pos = Math.floor(view.state.doc.length / 2);
        pos = view.state.doc.lineAt(pos).to;

        const keystroke = () => {
          const t = performance.now();
          view.dispatch({
            changes: { from: pos, insert: "x" },
            selection: { anchor: pos + 1 },
          });
          const elapsed = performance.now() - t;
          pos += 1;
          return elapsed;
        };

        for (let i = 0; i < WARMUP_KEYSTROKES; i += 1) {
          keystroke();
        }
        const timings: number[] = [];
        for (let i = 0; i < TIMED_KEYSTROKES; i += 1) {
          timings.push(keystroke());
        }
        view.destroy();

        return {
          label,
          bytes: document_.byteSize,
          lines: document_.lineCount,
          keystroke: { ...summarize(timings), timingsMs: timings },
        };
      });

      for (const m of measurements) {
        expect(
          m.keystroke.timingsMs.every((ms) => Number.isFinite(ms) && ms >= 0),
        ).toBe(true);
        expect(m.keystroke.medianMs).toBeLessThan(HARD_GATE_MEDIAN_MS);
      }

      const report = {
        capturedAt: new Date().toISOString(),
        machine: { platform: os.platform(), cpuCount: os.cpus().length },
        budget: {
          p50Ms: BUDGET_P50_MS,
          p95Ms: BUDGET_P95_MS,
          hardGateMedianMs: HARD_GATE_MEDIAN_MS,
          why:
            "#70: keystroke -> paint within one 60Hz frame on a 4GB machine. " +
            "jsdom measures the model + decoration slice (no layout/paint); " +
            "budget leaves the paint headroom. Keystroke cost must be " +
            "O(viewport): the xxlarge row staying with the others is the " +
            "structural assertion.",
        },
        measurements: measurements.map((m) => ({
          ...m,
          verdicts: {
            p50: m.keystroke.medianMs <= BUDGET_P50_MS ? "pass" : "over-budget",
            p95: m.keystroke.p95Ms <= BUDGET_P95_MS ? "pass" : "over-budget",
          },
        })),
      };
      writeFileSync(JSON_PATH, JSON.stringify(report, null, 2) + "\n");
    },
  );
});

function mountWithDoc(doc: string): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...markdownKeymap]),
        markdown(),
        EditorView.lineWrapping,
        markdownDecorationsPlugin,
      ],
    }),
    parent: document.body,
  });
}
