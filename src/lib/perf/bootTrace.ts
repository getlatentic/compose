/**
 * Frame-by-frame record of what a launch actually puts on screen.
 *
 * A boot timing number says when the document was ready; it says nothing about
 * how many *different* screens the user saw on the way there. Each of those
 * transitions is a flash. This samples a compact signature of the visible app
 * — pane geometry, tree rows, tab count, editor text — and keeps only the
 * samples where it changed, so the output is the list of distinct screens one
 * launch showed, with the time each appeared.
 *
 * Sampled on a timer rather than `requestAnimationFrame`: WKWebView throttles
 * RAF whenever the window isn't frontmost, which is exactly the launch this
 * most needs to record.
 *
 * Gated by `__COMPOSE_PERF__` like the rest of this module — a normal release
 * build drops it entirely.
 */

import { reportClientError } from "../diagnostics/errorReporter";

const SAMPLE_INTERVAL_MS = 8;
const TRACE_DURATION_MS = 6000;

function paneGeometry(): string {
  const pane =
    document.querySelector(".workspace") ?? document.querySelector(".app-skeleton");
  if (!pane) {
    return "none";
  }
  const columns = getComputedStyle(pane).gridTemplateColumns;
  // Round to whole pixels: sub-pixel drift from a resize isn't a flash.
  return columns.replace(/[\d.]+px/g, (px) => `${Math.round(parseFloat(px))}px`);
}

function screenSignature(): string {
  const skeleton = document.querySelector(".app-skeleton") ? "skeleton" : "app";
  const rows = document.querySelectorAll(".file-row").length;
  const tabs = document.querySelectorAll(".tab-button").length;
  const editor = document.querySelector(".cm-content");
  const chars = editor ? (editor.textContent ?? "").length : -1;
  const region = document.querySelector(".editor-region") ? "region" : "no-region";
  return [skeleton, paneGeometry(), `rows=${rows}`, `tabs=${tabs}`, region, `chars=${chars}`].join(
    " | ",
  );
}

export function startBootTrace(): void {
  if (!__COMPOSE_PERF__) return;

  const frames: string[] = [];
  let previous = "";

  function sample() {
    const signature = screenSignature();
    if (signature === previous) {
      return;
    }
    previous = signature;
    frames.push(`${performance.now().toFixed(0).padStart(5)}ms  ${signature}`);
  }

  const timer = window.setInterval(sample, SAMPLE_INTERVAL_MS);
  sample();

  window.setTimeout(() => {
    window.clearInterval(timer);
    const paints = performance
      .getEntriesByType("paint")
      .map((entry) => `${entry.startTime.toFixed(0).padStart(5)}ms  ${entry.name}`);
    const trace = [...paints, ...frames];
    // eslint-disable-next-line no-console
    console.log(["[boot-trace] distinct screens this launch:", ...trace].join("\n"));
    // Also to the local log: a launch is the one moment a devtools session
    // can't be attached in time, so the record has to survive without one.
    void reportClientError("boottrace", `${trace.length} distinct screens`, trace.join("\n"));
    (window as unknown as { __COMPOSE_BOOT_TRACE__?: string[] }).__COMPOSE_BOOT_TRACE__ = trace;
  }, TRACE_DURATION_MS);
}
