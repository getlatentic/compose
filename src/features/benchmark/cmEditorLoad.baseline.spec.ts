/**
 * CodeMirror 6 markdown-editor load latency baseline.
 *
 * Counterpart to `tiptapSetContent.baseline.spec.ts` for the v1.2
 * editor swap. Measures how long it takes to mount a fresh CM6
 * editor over a fixture of each size and call `dispatch({changes…})`
 * with the full document — the operation the
 * `CodeMirrorMarkdownEditor` runs when a file opens or the file
 * watcher pushes an external write.
 *
 * Per the v1.2 plan in `docs/editor-guide.md` this gate enforces
 * **< 1s on 1MB** — same end-state target as
 * `markdownPipelineLatency.baseline.spec.ts`, but for the editor
 * itself. Note the jsdom caveat: CM6 in jsdom skips real layout, so
 * the absolute number under-reads versus packaged WebKit. The
 * relative scaling curve (small → large → xlarge → xxlarge) is the
 * meaningful signal.
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

import { markdownDecorationsPlugin } from "../editor/codemirror/decorations/plugin";
import { buildDocument, type DocumentSizeLabel } from "./documentFixtures";
import { summarize } from "./statistics";

const JSON_PATH = path.join(
  process.cwd(),
  "docs",
  "benchmarks",
  "cm-editor-load.json",
);

// Full scaling series including 1MB. CM6 handles 1MB in milliseconds
// because it doesn't materialise per-block DOM — the viewport
// virtualisation is the structural fix v1.2 trades Tiptap for.
const SIZES: DocumentSizeLabel[] = ["small", "large", "xlarge", "xxlarge"];

// v1.2 hard gate: 1MB markdown loads into a fresh CM6 editor in
// under 1 second. Mirrors the `markdownPipelineLatency` gate so
// "1MB file open under 1s end-to-end" stays binding once these
// two costs add up.
const V1_2_TARGET_MS_1MB = 1000;

describe("codemirror editor load latency baseline", () => {
  it(
    "captures setContent timings per size",
    { timeout: 600_000 },
    () => {
      const measurements = SIZES.map((label) => {
        const document_ = buildDocument(label);

        // Mount cost: state + view from a fresh doc with the full
        // extension stack used in production.
        const mountTimings = runSamples(() => {
          const t = performance.now();
          const view = mountWithDoc(document_.text);
          const elapsed = performance.now() - t;
          view.destroy();
          return elapsed;
        });

        // Dispatch cost: the path the editor takes when an external
        // value comes in (file watcher, LLM write, file switch). Mount
        // a small editor, then replace its doc with the fixture.
        const dispatchTimings = runSamples(() => {
          const view = mountWithDoc("");
          const t = performance.now();
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: document_.text },
          });
          const elapsed = performance.now() - t;
          view.destroy();
          return elapsed;
        });

        return {
          label,
          bytes: document_.byteSize,
          lines: document_.lineCount,
          mount: { ...summarize(mountTimings), timingsMs: mountTimings },
          dispatch: { ...summarize(dispatchTimings), timingsMs: dispatchTimings },
        };
      });

      // Structural sanity — every sample must complete with a positive number.
      for (const m of measurements) {
        expect(m.mount.timingsMs.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true);
        expect(m.dispatch.timingsMs.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true);
      }

      // The gate: 1MB mount + dispatch (the editor's load path)
      // each stay under 1s on this machine. Either one over =
      // someone reintroduced an O(file) cost on the editor side.
      const oneMb = measurements.find((m) => m.label === "xxlarge");
      expect(oneMb, "xxlarge (1MB) measurement is required").toBeDefined();
      expect(oneMb!.mount.medianMs).toBeLessThan(V1_2_TARGET_MS_1MB);
      expect(oneMb!.dispatch.medianMs).toBeLessThan(V1_2_TARGET_MS_1MB);

      const report = {
        capturedAt: new Date().toISOString(),
        machine: { platform: os.platform(), cpuCount: os.cpus().length },
        target: {
          target1MbMs: V1_2_TARGET_MS_1MB,
          why:
            "Per docs/editor-guide.md v1.2 plan — replacing Tiptap with " +
            "CodeMirror 6 to hit < 1s on 1MB. CM6 virtualises the viewport, so " +
            "doc size only affects parser time, not DOM materialisation. This " +
            "spec asserts the 1MB case stays under 1s; the smaller sizes give " +
            "the scaling curve.",
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
