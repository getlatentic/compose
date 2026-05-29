/**
 * Render a `BenchmarkReport` to the two committed artifacts:
 *   * `baseline.json` — the machine-diffable source of truth.
 *   * `baseline.md` — a human-readable table for PR review.
 *
 * Pure string transforms (no I/O), so they unit-test without running the
 * benchmark. The `.baseline.spec.ts` entry owns the file writes.
 */

import type { BenchmarkReport, ScenarioReport } from "./lagBenchmark";
import type { OperationResult } from "./operationResult";

/** Canonical JSON form, two-space indent, trailing newline. */
export function toBaselineJson(report: BenchmarkReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Human-readable Markdown report mirroring the JSON. */
export function toBaselineMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [
    "# Editor lag baseline",
    "",
    `Captured: \`${report.capturedAt}\``,
    `Machine: \`${report.machine.platform}\` / ${report.machine.cpuCount} CPUs`,
    "",
    "## Measurement caveats",
    ...report.measurementCaveats.map((caveat) => `- ${caveat}`),
    "",
    "## Scenarios",
    "",
  ];

  for (const scenario of report.scenarios) {
    lines.push(...renderScenario(scenario));
  }

  lines.push("_Re-run with `pnpm bench:baseline`. Compare post-change numbers against this file._");
  return `${lines.join("\n")}\n`;
}

function renderScenario(scenario: ScenarioReport): string[] {
  const header = `### \`${scenario.scenario}\` — ${formatCount(scenario.documentLineCount)} lines, ${humanizeBytes(scenario.documentByteSize)}`;
  const out: string[] = [
    header,
    "",
    "| Operation | Samples | Median (ms) | p95 (ms) | Mean (ms) |",
    "|---|---:|---:|---:|---:|",
    ...scenario.operations.map(renderOperationRow),
    "",
  ];
  return out;
}

function renderOperationRow(op: OperationResult): string {
  return `| \`${op.name}\` | ${op.samples} | ${fixed2(op.medianMs)} | ${fixed2(op.p95Ms)} | ${fixed2(op.meanMs)} |`;
}

function fixed2(value: number): string {
  return value.toFixed(2);
}

/** Group thousands with commas: 10802 → "10,802". */
function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** 263 → "263 B", 299298 → "292.3 KB", 1086698 → "1.04 MB". */
function humanizeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
