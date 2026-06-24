import { describe, expect, it } from "vitest";

import type { TraceEntry } from "../../app/workspaceModel";
import type { ToolKind } from "../../lib/ipc/harnessClient";
import { appliedChangeBasenames, fileOpsFromTrace, readFilesFromTrace } from "./traceFiles";

/** A tool trace entry carrying a neutral `kind` (as the harness now supplies)
 * — the routing key these helpers read, independent of the tool's `name`. */
function tool(
  kind: ToolKind,
  opts: { id?: string; name?: string; input?: string; status?: "running" | "done" | "error" } = {},
): TraceEntry {
  return {
    kind: "tool",
    tool: {
      id: opts.id ?? kind,
      name: opts.name ?? kind,
      kind,
      status: opts.status ?? "done",
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

  it("folds a failed edit into a later success on the same file (recovery)", () => {
    // Claude's "File has not been read yet" retry: the first edit errors, the
    // next one lands. The reader should see the outcome, not the scary fumble.
    const trace: TraceEntry[] = [
      tool("edit", { id: "e1", status: "error", input: JSON.stringify({ path: "/a/x.md" }) }),
      tool("edit", { id: "e2", status: "done", input: JSON.stringify({ path: "/a/x.md" }) }),
    ];
    expect(fileOpsFromTrace(trace).map((entry) => entry.id)).toEqual(["e2"]);
  });

  it("keeps a failed op when nothing later succeeds on that file", () => {
    const trace: TraceEntry[] = [
      tool("edit", { id: "e1", status: "error", input: JSON.stringify({ path: "/a/x.md" }) }),
      // a success on a DIFFERENT file must not rescue x.md's failure
      tool("write", { id: "w1", status: "done", input: JSON.stringify({ path: "/a/y.md" }) }),
    ];
    expect(fileOpsFromTrace(trace).map((entry) => entry.id)).toEqual(["e1", "w1"]);
  });

  it("keeps a failure that comes AFTER a success on the same file (not a recovery)", () => {
    const trace: TraceEntry[] = [
      tool("edit", { id: "e1", status: "done", input: JSON.stringify({ path: "/a/x.md" }) }),
      tool("edit", { id: "e2", status: "error", input: JSON.stringify({ path: "/a/x.md" }) }),
    ];
    expect(fileOpsFromTrace(trace).map((entry) => entry.id)).toEqual(["e1", "e2"]);
  });

  it("suppresses write/edit cards for files an applied diff already covers", () => {
    const trace: TraceEntry[] = [
      // a write_to_file overwrite — the applied diff (which knows the file
      // pre-existed) owns this headline, so the per-tool "Created" card drops.
      tool("write", { id: "w1", input: JSON.stringify({ path: "/vault/notes/x.md" }) }),
      // an edit to a file the diff does NOT cover — its card survives.
      tool("edit", { id: "e1", input: JSON.stringify({ path: "/vault/notes/y.md" }) }),
    ];
    const covered = appliedChangeBasenames([{ filePath: "notes/x.md" }]);
    expect(fileOpsFromTrace(trace, covered).map((entry) => entry.id)).toEqual(["e1"]);
  });

  it("dedupes case-insensitively (a `welcome.md` write vs a `Welcome.md` diff)", () => {
    const trace: TraceEntry[] = [
      tool("write", { id: "w1", input: JSON.stringify({ path: "/vault/welcome.md" }) }),
    ];
    const covered = appliedChangeBasenames([{ filePath: "Welcome.md" }]);
    expect(fileOpsFromTrace(trace, covered)).toEqual([]);
  });

  it("keeps a card when the op has no resolvable filename to match", () => {
    const trace: TraceEntry[] = [tool("write", { id: "w1", input: "not json" })];
    const covered = appliedChangeBasenames([{ filePath: "notes/x.md" }]);
    expect(fileOpsFromTrace(trace, covered).map((entry) => entry.id)).toEqual(["w1"]);
  });

  it("ignores an empty covered set (no dedupe)", () => {
    const trace: TraceEntry[] = [
      tool("write", { id: "w1", input: JSON.stringify({ path: "/vault/notes/x.md" }) }),
    ];
    expect(fileOpsFromTrace(trace, new Set()).map((entry) => entry.id)).toEqual(["w1"]);
  });
});

describe("appliedChangeBasenames", () => {
  it("reduces workspace-relative paths to basenames", () => {
    const names = appliedChangeBasenames([
      { filePath: "notes/x.md" },
      { filePath: "deep/nested/dir/report.md" },
    ]);
    expect(names.has("x.md")).toBe(true);
    expect(names.has("report.md")).toBe(true);
  });

  it("lower-cases basenames so a case-mismatched path still matches", () => {
    const names = appliedChangeBasenames([{ filePath: "notes/Welcome.md" }]);
    expect(names.has("welcome.md")).toBe(true);
  });

  it("returns an empty set for undefined", () => {
    expect(appliedChangeBasenames(undefined).size).toBe(0);
  });
});
