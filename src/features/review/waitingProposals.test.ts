import { describe, expect, it } from "vitest";

import { createWorkspaceFromPath } from "../../app/workspace/workspaces";
import type { Workspace, WorkspaceChatMessage, WorkspaceDocumentSuggestion } from "../../app/workspace/types";
import { recordReviewDecision } from "./fileReviews";
import { liveEdits } from "./liveEdits";
import { notesToRead, waitingProposals } from "./waitingProposals";

const BEFORE = "---\ntags: [a]\n---\nTranscripts were analysed following Braun and Clarke, moving to named themes.\n";
const AFTER = "---\ntags: [a]\n---\nTranscripts were coded following Braun and Clarke (2006), moving to labelled themes.\n";

const base = { title: "Edit", statusMessage: null, createdAt: 1, updatedAt: 1, previewOmitted: false };

function rewrite(id: string, status: WorkspaceDocumentSuggestion["status"] = "pending", filePath = "a.md"): WorkspaceDocumentSuggestion {
  return { ...base, id, runId: `run-${id}`, filePath, status, kind: "rewrite", originalText: BEFORE, newText: AFTER, originalSize: 1, newSize: 1, stale: false };
}

function workspaceWith(suggestions: WorkspaceDocumentSuggestion[], open: Record<string, string> = {}): Workspace {
  const ws = createWorkspaceFromPath("/tmp/notes");
  const message: WorkspaceChatMessage = { id: "m1", role: "assistant", content: "Done.", activity: null, runId: "run-1", suggestions };
  const fileContents = Object.fromEntries(
    Object.entries(open).map(([path, content]) => [path, { content, conflict: false, dirty: false, lastModifiedMs: 1, pendingChanges: [] }]),
  );
  return { ...ws, fileContents, chatThread: { ...ws.chatThread, messages: [message] } };
}

describe("waitingProposals", () => {
  it("has nothing when no proposal is waiting", () => {
    expect(waitingProposals(workspaceWith([rewrite("s1", "accepted"), rewrite("s2", "rejected")]))).toEqual({ files: [], suggestionIds: [] });
  });

  it("starts the sandbox from an untouched proposal as the agent wrote it", () => {
    const waiting = waitingProposals(workspaceWith([rewrite("s1")], { "a.md": BEFORE }));
    expect(waiting).toEqual({ files: [{ relativePath: "a.md", content: AFTER }], suggestionIds: ["s1"] });
  });

  it("carries a new file, and a deletion as a missing file", () => {
    const created: WorkspaceDocumentSuggestion = { ...base, id: "c1", runId: "run-c", filePath: "Ideas/new.md", status: "pending", kind: "create", newText: "Idea.\n", newSize: 6 };
    const deleted: WorkspaceDocumentSuggestion = { ...base, id: "d1", runId: "run-d", filePath: "old.md", status: "pending", kind: "delete", originalText: "Old.\n", originalSize: 5, stale: false };
    expect(waitingProposals(workspaceWith([created, deleted])).files).toEqual([
      { relativePath: "Ideas/new.md", content: "Idea.\n" },
      { relativePath: "old.md", content: null },
    ]);
  });

  it("leaves out what the writer rejected and keeps the rest, front matter included", () => {
    let workspace = workspaceWith([rewrite("s1")], { "a.md": BEFORE });
    const body = BEFORE.slice(BEFORE.indexOf("Transcripts"));
    const review = { id: "s1", mode: "pending" as const, agentName: "", original: body, proposed: AFTER.slice(AFTER.indexOf("Transcripts")), kept: [], dropped: [] };
    const year = liveEdits(review, body).find((edit) => edit.added.includes("2006"));
    workspace = recordReviewDecision(workspace, "s1", year!.key, false).workspace;

    const [file] = waitingProposals(workspace).files;
    expect(file.content).toBe("---\ntags: [a]\n---\nTranscripts were coded following Braun and Clarke, moving to labelled themes.\n");
  });

  it("carries only the newest proposal per file, and leaves an older one waiting", () => {
    const waiting = waitingProposals(workspaceWith([rewrite("s1"), rewrite("s2"), rewrite("s3", "pending", "b.md")]));
    expect(waiting.suggestionIds).toEqual(["s2", "s3"]);
  });

  it("reads a decided note whose tab is closed from disk, and never sends back what the writer rejected", () => {
    let workspace = workspaceWith([rewrite("s1")], { "a.md": BEFORE });
    const body = BEFORE.slice(BEFORE.indexOf("Transcripts"));
    const review = { id: "s1", mode: "pending" as const, agentName: "", original: body, proposed: AFTER.slice(AFTER.indexOf("Transcripts")), kept: [], dropped: [] };
    const year = liveEdits(review, body).find((edit) => edit.added.includes("2006"));
    workspace = recordReviewDecision(workspace, "s1", year!.key, false).workspace;
    const closed = { ...workspace, fileContents: {} };

    expect(notesToRead(closed)).toEqual(["a.md"]);
    expect(waitingProposals(closed)).toEqual({ files: [], suggestionIds: [] });
    const [file] = waitingProposals(closed, new Map([["a.md", BEFORE]])).files;
    expect(file.content).not.toContain("2006");
  });

  it("needs nothing read for an undecided proposal", () => {
    expect(notesToRead(workspaceWith([rewrite("s1")]))).toEqual([]);
  });
});
