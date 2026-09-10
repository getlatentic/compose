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

function boxHeight(selector: string): number {
  const element = document.querySelector(selector);
  return element ? Math.round(element.getBoundingClientRect().height) : -1;
}

/** Where the document's first line sits. A number that moves is the editor
 *  shifting under the reader, which a character count cannot show. */
function firstLineTop(): number {
  const line = document.querySelector(".cm-content .cm-line");
  return line ? Math.round(line.getBoundingClientRect().top) : -1;
}

function screenSignature(): string {
  const skeleton = document.querySelector(".app-skeleton") ? "skeleton" : "app";
  const rows = document.querySelectorAll(".file-row").length;
  const tabs = document.querySelectorAll(".tab-button").length;
  const editor = document.querySelector(".cm-content");
  const chars = editor ? (editor.textContent ?? "").length : -1;
  const region = document.querySelector(".editor-region") ? "region" : "no-region";
  // Content height vs rendered window: the first is what moves a scrollbar, the
  // second is only virtualisation filling in. They look identical in a row count.
  const treeContent = boxHeight(".file-tree__sizer");
  const treeViewport = boxHeight(".file-tree");
  const tree = document.querySelector("#root .file-tree");
  return [
    skeleton,
    `liveTreeScroll=${tree ? Math.round(tree.scrollTop) : -1}`,
    paneGeometry(),
    `rows=${rows}`,
    `treeContent=${treeContent}`,
    `treeViewport=${treeViewport}`,
    `tabs=${tabs}`,
    region,
    `chars=${chars}`,
    `docHeight=${boxHeight(".cm-content")}`,
    `line1Top=${firstLineTop()}`,
  ].join(" | ");
}


function ms(value: number): string {
  return `${value.toFixed(0).padStart(5)}ms`;
}

/** What the parser was doing, so a first paint that arrives late can be read
 *  against the document it was waiting on rather than guessed at. */
function documentMilestones(): string[] {
  const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  if (!navigation) {
    return [];
  }
  return [
    `${ms(navigation.responseEnd)}  document received`,
    `${ms(navigation.domInteractive)}  dom interactive`,
    `${ms(navigation.domContentLoadedEventEnd)}  dom content loaded`,
  ];
}

/** The eager assets. A stylesheet in <head> blocks every paint including the
 *  skeleton's, so its arrival is the floor under everything the user sees. */
function blockingResources(): string[] {
  return (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
    .filter((entry) => /\/assets\/(index|react|carbon|markdown|katex|codemirror|ActiveDocument)-/.test(entry.name))
    .map(
      (entry) =>
        `${ms(entry.responseEnd)}  loaded ${entry.name.replace(/^.*\/assets\//, "")} (started ${ms(entry.startTime).trim()}, ${Math.round(entry.decodedBodySize / 1024)}KB)`,
    );
}

function prerenderMark(): string[] {
  const at = (window as { __COMPOSE_PRERENDER_AT__?: number }).__COMPOSE_PRERENDER_AT__;
  return typeof at === "number" ? [`${ms(at)}  payload text written to the DOM`] : [];
}

function paintEntries(): string[] {
  return performance.getEntriesByType("paint").map((entry) => `${ms(entry.startTime)}  ${entry.name}`);
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
    const paints = [...documentMilestones(), ...blockingResources(), ...prerenderMark(), ...paintEntries()];
    const marks = (globalThis as unknown as { __BOOT_MARKS__?: string[] }).__BOOT_MARKS__ ?? [];
    marks.push(`DOM nodes: ${document.getElementsByTagName("*").length}`);
    const trace = [...marks.map((m) => `      -  ${m}`), ...paints, ...frames];
    // eslint-disable-next-line no-console
    console.log(["[boot-trace] distinct screens this launch:", ...trace].join("\n"));
    // Also to the local log: a launch is the one moment a devtools session
    // can't be attached in time, so the record has to survive without one.
    void reportClientError("boottrace", `${trace.length} distinct screens`, trace.join("\n"));
    (window as unknown as { __COMPOSE_BOOT_TRACE__?: string[] }).__COMPOSE_BOOT_TRACE__ = trace;
  }, TRACE_DURATION_MS);
}
