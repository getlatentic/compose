import { describe, expect, it } from "vitest";

import type { TraceEntry } from "../../app/workspaceModel";
import type { ToolKind } from "../../lib/ipc/bobClient";
import { fileOpsFromTrace, readFilesFromTrace } from "./traceFiles";

/** A tool trace entry carrying a neutral `kind` (as the harness now supplies)
 * — the routing key these helpers read, independent of the tool's `name`. */
function tool(
  kind: ToolKind,
  opts: { id?: string; name?: string; input?: string } = {},
): TraceEntry {
  return {
    kind: "tool",
    tool: {
      id: opts.id ?? kind,
      name: opts.name ?? kind,
      kind,
      status: "done",
      input: opts.input,
    },
  };
}

/** A read whose JSON input carries an absolute path. */
function read(path: string): TraceEntry {
  return tool("read", { input: JSON.stringify({ path }) });
}

describe("readFilesFromTrace", () => {
  it("returns [] for an undefined trace", () => {
    expect(readFilesFromTrace(undefined)).toEqual([]);
  });

  it("collects read basenames in first-seen order, deduped", () => {
    const trace: TraceEntry[] = [
      { kind: "thinking", text: "considering the notes" },
      read("/abs/research/Q3 field notes.md"),
      tool("write", { input: JSON.stringify({ path: "/abs/temple list.md" }) }),
      read("/abs/research/Q3 field notes.md"), // duplicate — dropped
      read("/abs/notes/reading list.md"),
    ];
    expect(readFilesFromTrace(trace)).toEqual(["Q3 field notes.md", "reading list.md"]);
  });

  it("ignores non-read tools and reads without a parseable path", () => {
    const trace: TraceEntry[] = [
      tool("search", { input: JSON.stringify({ query: "x" }) }),
      tool("read", { input: "not json" }),
      { kind: "notice", text: "looked around" },
    ];
    expect(readFilesFromTrace(trace)).toEqual([]);
  });
});

describe("fileOpsFromTrace", () => {
  it("returns [] for an undefined trace", () => {
    expect(fileOpsFromTrace(undefined)).toEqual([]);
  });

  it("collects write/edit ops in arrival order, leaving reads and others out", () => {
    const trace: TraceEntry[] = [
      read("/a/x.md"),
      tool("write", { id: "w1", input: JSON.stringify({ path: "/a/new.md" }) }),
      tool("edit", { id: "e1", input: JSON.stringify({ path: "/a/x.md" }) }),
      tool("execute", { id: "c1" }),
      tool("edit", { id: "e2", input: JSON.stringify({ path: "/a/y.md" }) }),
    ];
    expect(fileOpsFromTrace(trace).map((entry) => entry.id)).toEqual(["w1", "e1", "e2"]);
  });

  it("keeps repeated edits to the same file as distinct ops", () => {
    const trace: TraceEntry[] = [
      tool("edit", { id: "e1", input: JSON.stringify({ path: "/a/x.md" }) }),
      tool("edit", { id: "e2", input: JSON.stringify({ path: "/a/x.md" }) }),
    ];
    expect(fileOpsFromTrace(trace).map((entry) => entry.id)).toEqual(["e1", "e2"]);
  });
});
