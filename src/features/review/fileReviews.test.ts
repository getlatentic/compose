import { describe, expect, it } from "vitest";

import { createWorkspaceFromPath, type Workspace, type WorkspaceChatMessage } from "../../app/workspaceModel";
import { fileReviewsFor, recordReviewDecision } from "./fileReviews";
import { agentEditKeys } from "./agentEdits";

const BEFORE = "---\ntags: [a]\n---\nOne.\n\nTwo.\n";
const AFTER = "---\ntags: [a]\n---\nOne, changed.\n\nTwo, changed.\n";

function workspaceWith(message: Partial<WorkspaceChatMessage>): Workspace {
  const base = createWorkspaceFromPath("/tmp/notes");
  const assistant: WorkspaceChatMessage = { id: "m1", role: "assistant", content: "Done.", activity: null, runId: "run-1", ...message };
  return { ...base, chatThread: { ...base.chatThread, messages: [assistant] } };
}

const pending = () =>
  workspaceWith({
    suggestions: [
      {
        id: "s1",
        runId: "run-1",
        filePath: "a.md",
        title: "Edit",
        status: "pending",
        statusMessage: null,
        createdAt: 1,
        updatedAt: 1,
        kind: "rewrite",
        originalText: BEFORE,
        newText: AFTER,
        originalSize: BEFORE.length,
        newSize: AFTER.length,
        previewOmitted: false,
        stale: false,
      },
    ],
  });

describe("fileReviewsFor", () => {
  it("reviews the note's body, not its front matter, which the editor does not show", () => {
    const [review] = fileReviewsFor(pending().chatThread, "a.md", "Claude");
    expect(review).toMatchObject({ id: "s1", mode: "pending", agentName: "Claude", original: "One.\n\nTwo.\n" });
    expect(fileReviewsFor(pending().chatThread, "b.md", "Claude")).toEqual([]);
  });

  it("credits a change to the agent whose run made it, not the one selected now", () => {
    const workspace = pending();
    const [message] = workspace.chatThread.messages;
    const thread = { ...workspace.chatThread, messages: [{ ...message, agentName: "Claude Code" }] };
    expect(fileReviewsFor(thread, "a.md", "Codex")[0].agentName).toBe("Claude Code");
  });

  it("reviews an applied change as applied", () => {
    const workspace = workspaceWith({
      appliedChanges: [
        { id: "m1-applied-1", kind: "rewrite", filePath: "a.md", originalText: BEFORE, newText: AFTER, originalSize: 1, newSize: 1, previewOmitted: false },
      ],
    });
    expect(fileReviewsFor(workspace.chatThread, "a.md", "Codex")[0]).toMatchObject({ id: "m1-applied-1", mode: "applied" });
  });
});

describe("recordReviewDecision", () => {
  const keys = agentEditKeys("One.\n\nTwo.\n", "One, changed.\n\nTwo, changed.\n");

  it("settles a pending change only once every edit is decided, accepted if any was kept", () => {
    const first = recordReviewDecision(pending(), "s1", keys[0], false);
    expect(first.settled).toBeNull();
    const second = recordReviewDecision(first.workspace, "s1", keys[1], true);
    expect(second.settled).toEqual({ suggestionId: "s1", runId: "run-1", anyKept: true });
  });

  it("settles as rejected when nothing was kept", () => {
    const first = recordReviewDecision(pending(), "s1", keys[0], false);
    expect(recordReviewDecision(first.workspace, "s1", keys[1], false).settled?.anyKept).toBe(false);
  });

  it("hands a decision to the next review", () => {
    const { workspace } = recordReviewDecision(pending(), "s1", keys[0], true);
    expect(fileReviewsFor(workspace.chatThread, "a.md", "Claude")[0]).toMatchObject({ kept: [keys[0]], dropped: [] });
  });
});
