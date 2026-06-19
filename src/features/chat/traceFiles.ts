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

/**
 * The create/edit tool calls of this turn, in arrival order, each rendered
 * as a file-op card. Multiple edits to the same file stay distinct (each is
 * a real operation with its own running → done/error lifecycle).
 *
 * `coveredFiles` are the basenames a turn's applied-diff cards already own
 * (snapshot mode — see {@link appliedChangeBasenames}). The applied diff knows
 * whether a file pre-existed, so it is the source of truth for create-vs-edit;
 * a per-tool `write`/`edit` card for the *same* file would otherwise contradict
 * it ("Created" vs "Edited" for one overwrite). We drop those redundant cards so
 * the applied diff owns the headline. A tool op with no resolvable filename, or
 * one not covered by an applied diff, still surfaces its card.
 */
export function fileOpsFromTrace(
  trace: TraceEntry[] | undefined,
  coveredFiles?: ReadonlySet<string>,
): WorkspaceToolCall[] {
  if (!trace) {
    return [];
  }
  const ops: WorkspaceToolCall[] = [];
  for (const entry of trace) {
    if (entry.kind !== "tool" || (entry.tool.kind !== "write" && entry.tool.kind !== "edit")) {
      continue;
    }
    if (coveredFiles && coveredFiles.size > 0) {
      const file = toolFile(entry.tool.input);
      if (file && coveredFiles.has(file.toLowerCase())) {
        continue;
      }
    }
    ops.push(entry.tool);
  }
  return ops;
}

/** Basenames of the files an applied-diff set covers, for {@link fileOpsFromTrace}
 * deduping. The applied change's `filePath` is workspace-relative; reduce it to
 * a basename so it joins against the tool card's `toolFile` (also a basename). */
export function appliedChangeBasenames(
  changes: { filePath: string }[] | undefined,
): Set<string> {
  const names = new Set<string>();
  if (!changes) {
    return names;
  }
  for (const change of changes) {
    const segments = change.filePath.split(/[/\\]/).filter(Boolean);
    const base = segments[segments.length - 1];
    if (base) {
      // Lower-cased: macOS is case-insensitive, so a model that writes
      // `welcome.md` while the file on disk is `Welcome.md` must still dedup
      // against the applied diff — otherwise both a tool card and the diff show.
      names.add(base.toLowerCase());
    }
  }
  return names;
}
