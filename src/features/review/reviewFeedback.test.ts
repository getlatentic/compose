import { describe, expect, it } from "vitest";

import {
  createWorkspaceFromPath,
  type Workspace,
  type WorkspaceAppliedChange,
  type WorkspaceChatMessage,
  type WorkspaceRewriteSuggestion,
} from "../../app/workspaceModel";
import { recordReviewDecision, recordReviewFeedbackSent } from "./fileReviews";
import { reviewBlockKeys } from "./liveBlocks";
import { reviewFeedbackFor, withReviewFeedback } from "./reviewFeedback";

const BEFORE = "---\ntags: [a]\n---\nBraun and Clarke describe thematic analysis.\n\nSecond paragraph.\n";
const AFTER = "---\ntags: [a]\n---\nBraun and Clarke (2006) describe thematic analysis.\n\nSecond paragraph, revised.\n";
const [YEAR_KEY, REVISED_KEY] = reviewBlockKeys({
  original: "Braun and Clarke describe thematic analysis.\n\nSecond paragraph.\n",
  proposed: "Braun and Clarke (2006) describe thematic analysis.\n\nSecond paragraph, revised.\n",
});

function workspaceWith(message: Partial<WorkspaceChatMessage>): Workspace {
  const base = createWorkspaceFromPath("/tmp/notes");
  const assistant: WorkspaceChatMessage = { id: "m1", role: "assistant", content: "Done.", activity: null, runId: "run-1", ...message };
  return { ...base, chatThread: { ...base.chatThread, messages: [assistant] } };
}

function applied(overrides: Partial<WorkspaceAppliedChange> = {}): Workspace {
  return workspaceWith({
    appliedChanges: [
      {
        id: "c1",
        kind: "rewrite",
        filePath: "Slip Box review.md",
        originalText: BEFORE,
        newText: AFTER,
        originalSize: BEFORE.length,
        newSize: AFTER.length,
        previewOmitted: false,
        ...overrides,
      },
    ],
  });
}

function pending(overrides: Partial<WorkspaceRewriteSuggestion> = {}): Workspace {
  return workspaceWith({
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
        ...overrides,
      },
    ],
  });
}

describe("reviewFeedbackFor", () => {
  it("says nothing when the writer has not undone or rejected anything", () => {
    expect(reviewFeedbackFor(applied().chatThread)).toBeNull();
    expect(reviewFeedbackFor(pending().chatThread)).toBeNull();
  });

  it("says nothing about kept or accepted changes", () => {
    const kept = recordReviewDecision(applied(), "c1", YEAR_KEY, true).workspace;
    expect(reviewFeedbackFor(kept.chatThread)).toBeNull();
    const accepted = recordReviewDecision(pending(), "s1", YEAR_KEY, true).workspace;
    expect(reviewFeedbackFor(accepted.chatThread)).toBeNull();
  });

  it("tells the agent the exact words the writer undid, and where", () => {
    const undone = recordReviewDecision(applied(), "c1", YEAR_KEY, false).workspace;
    const feedback = reviewFeedbackFor(undone.chatThread);
    expect(feedback?.note).toBe(
      [
        "Since your last turn the writer took some of your edits back out:",
        '- The writer undid your change to `Slip Box review.md`: you had added "(2006)" after "Braun and Clarke".',
        "These are not in the notes now on purpose. Leave them out unless the writer asks for them.",
      ].join("\n"),
    );
    expect(feedback?.sent).toEqual([{ reviewId: "c1", key: YEAR_KEY }]);
  });

  it("names a block rejected in the margin, and only that block", () => {
    const rejected = recordReviewDecision(pending(), "s1", REVISED_KEY, false).workspace;
    const feedback = reviewFeedbackFor(rejected.chatThread);
    expect(feedback?.note).toContain(
      '- The writer rejected your change to `a.md`: you had added ", revised" after "Second paragraph".',
    );
    expect(feedback?.note).not.toContain("2006");
    expect(feedback?.sent).toEqual([{ reviewId: "s1", key: REVISED_KEY }]);
  });

  it("counts every block of a change rejected from the chat card, except any already kept", () => {
    const keptOne = recordReviewDecision(pending(), "s1", YEAR_KEY, true).workspace;
    const message = keptOne.chatThread.messages[0];
    const rejected: Workspace = {
      ...keptOne,
      chatThread: {
        ...keptOne.chatThread,
        messages: [{ ...message, suggestions: message.suggestions?.map((s) => ({ ...s, status: "rejected" as const })) }],
      },
    };
    expect(reviewFeedbackFor(rejected.chatThread)?.sent).toEqual([{ reviewId: "s1", key: REVISED_KEY }]);
  });

  it("is told once: cleared after it is sent, while a later undo is still told", () => {
    const undone = recordReviewDecision(applied(), "c1", YEAR_KEY, false).workspace;
    const first = reviewFeedbackFor(undone.chatThread);
    const sent = recordReviewFeedbackSent(undone, first?.sent ?? []);
    expect(reviewFeedbackFor(sent.chatThread)).toBeNull();

    const later = recordReviewDecision(sent, "c1", REVISED_KEY, false).workspace;
    expect(reviewFeedbackFor(later.chatThread)?.sent).toEqual([{ reviewId: "c1", key: REVISED_KEY }]);
  });

  it("skips a change whose text was too large to preview", () => {
    const omitted = applied({ previewOmitted: true });
    const undone = recordReviewDecision(omitted, "c1", YEAR_KEY, false).workspace;
    expect(reviewFeedbackFor(undone.chatThread)).toBeNull();
  });

  it("names a bounded number of changes and counts the rest", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `Line ${index}.`);
    const before = `${lines.join("\n\n")}\n`;
    const after = `${lines.map((line) => `${line} Edited.`).join("\n\n")}\n`;
    let workspace = applied({ originalText: before, newText: after });
    for (const key of reviewBlockKeys({ original: before, proposed: after })) {
      workspace = recordReviewDecision(workspace, "c1", key, false).workspace;
    }
    const feedback = reviewFeedbackFor(workspace.chatThread);
    expect(feedback?.sent).toHaveLength(30);
    expect(feedback?.note.split("\n").filter((line) => line.startsWith("- The writer"))).toHaveLength(12);
    expect(feedback?.note).toContain("…and 18 more of your changes the writer undid or rejected.");
  });

  it("shortens a long passage it quotes", () => {
    const long = "word ".repeat(60).trim();
    const before = "Intro.\n";
    const after = `Intro.\n\n${long}\n`;
    const [key] = reviewBlockKeys({ original: before, proposed: after });
    const undone = recordReviewDecision(applied({ originalText: before, newText: after }), "c1", key, false).workspace;
    const note = reviewFeedbackFor(undone.chatThread)?.note ?? "";
    expect(note).toMatch(/you had added "word( word)*…"/);
    expect(note.length).toBeLessThan(400);
  });
});

describe("withReviewFeedback", () => {
  it("puts the note in front of the writer's message, or leaves the message alone", () => {
    const undone = recordReviewDecision(applied(), "c1", YEAR_KEY, false).workspace;
    const feedback = reviewFeedbackFor(undone.chatThread);
    expect(withReviewFeedback("Tighten the intro.", feedback)).toBe(`${feedback?.note}\n\nTighten the intro.`);
    expect(withReviewFeedback("Tighten the intro.", null)).toBe("Tighten the intro.");
  });
});
