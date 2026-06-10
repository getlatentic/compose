import type { TraceEntry, WorkspaceToolCall } from "../../app/workspaceModel";
import { toolFile } from "./toolLabels";

/**
 * Derive the file-aware message-stream surfaces from a turn's agent trace.
 *
 * The trace is the single source of truth (reasoning / narration / tool
 * calls in arrival order); these helpers pull just the file-touching tool
 * calls back out so the turn can show *what the assistant did to your
 * files* up front, rather than burying it in the collapsed trace:
 *
 *  - {@link readFilesFromTrace} → the files it read, as compact pills on
 *    the turn header;
 *  - {@link fileOpsFromTrace} → the create/edit operations, as prominent
 *    cards in the message flow.
 *
 * Both are pure and cheap; they re-run on each render off the same trace
 * the row already holds (no extra state, no per-entry allocation beyond the
 * small result arrays).
 */

/** Basenames of the files this turn read, in first-seen order, deduped. */
export function readFilesFromTrace(trace: TraceEntry[] | undefined): string[] {
  if (!trace) {
    return [];
  }
  const seen = new Set<string>();
  const files: string[] = [];
  for (const entry of trace) {
    if (entry.kind !== "tool" || entry.tool.kind !== "read") {
      continue;
    }
    const file = toolFile(entry.tool.input);
    if (file && !seen.has(file)) {
      seen.add(file);
      files.push(file);
    }
  }
  return files;
}

/** The create/edit tool calls of this turn, in arrival order, each rendered
 * as a file-op card. Multiple edits to the same file stay distinct (each is
 * a real operation with its own running → done/error lifecycle). */
export function fileOpsFromTrace(trace: TraceEntry[] | undefined): WorkspaceToolCall[] {
  if (!trace) {
    return [];
  }
  const ops: WorkspaceToolCall[] = [];
  for (const entry of trace) {
    if (entry.kind === "tool" && (entry.tool.kind === "write" || entry.tool.kind === "edit")) {
      ops.push(entry.tool);
    }
  }
  return ops;
}
