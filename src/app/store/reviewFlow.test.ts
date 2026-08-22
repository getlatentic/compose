import { beforeEach, describe, expect, it, vi } from "vitest";

const reviewCleanup = vi.fn(async () => {});
vi.mock("../../lib/ipc/reviewClient", () => ({
  applyReviewChange: vi.fn(),
  reviewCleanup: (runId: string) => reviewCleanup(runId),
  reviewDiff: vi.fn(),
  snapshotDiff: vi.fn(),
}));

const { findWorkspaceSuggestion, maybeCleanupReview, reviewChangeToDraft } = await import(
  "./reviewFlow"
);
type Suggestion = Record<string, unknown>;

function suggestion(over: Suggestion = {}): Suggestion {
  return {
    id: "s1",
    runId: "r1",
    filePath: "notes.md",
    title: "notes.md",
    kind: "rewrite",
    status: "pending",
    statusMessage: null,
    createdAt: 0,
    updatedAt: 0,
    originalText: "a",
    newText: "b",
    ...over,
  };
}

function storeWith(suggestions: Suggestion[]) {
  return () =>
    ({
      workspaces: [
        {
          id: "ws",
          chatThread: { messages: [{ id: "m1", suggestions }] },
        },
      ],
    }) as never;
}

beforeEach(() => reviewCleanup.mockClear());

describe("discarding a run's review sandbox", () => {
  it("keeps the sandbox while a change is still waiting on the user", () => {
    // The sandbox holds the agent's edits; the live files do not have them yet.
    // Discarding it while a suggestion is pending destroys work the user was
    // still deciding about, and the Accept button then has nothing to apply.
    maybeCleanupReview(storeWith([suggestion()]), "ws", "r1");
    expect(reviewCleanup).not.toHaveBeenCalled();
  });

  it("discards it once every change has been decided", () => {
    // The other half: never cleaning up leaves a temp copy of the workspace per
    // run for the rest of the session.
    maybeCleanupReview(storeWith([suggestion({ status: "accepted" })]), "ws", "r1");
    expect(reviewCleanup).toHaveBeenCalledWith("r1");
  });

  it("is not held open by another run's pending changes", () => {
    // Each run owns its own sandbox. Counting a sibling run's suggestions would
    // leak this one's for as long as the other stayed undecided.
    maybeCleanupReview(storeWith([suggestion({ runId: "r2" })]), "ws", "r1");
    expect(reviewCleanup).toHaveBeenCalledWith("r1");
  });

  it("is not held open by an inline edit, which has no sandbox", () => {
    // `replace` is applied to the loaded buffer, not through the review
    // session, so it can sit pending forever without owning a temp dir.
    maybeCleanupReview(storeWith([suggestion({ kind: "replace" })]), "ws", "r1");
    expect(reviewCleanup).toHaveBeenCalledWith("r1");
  });

  it("does nothing for a workspace that is no longer open", () => {
    maybeCleanupReview((() => ({ workspaces: [] })) as never, "ws", "r1");
    expect(reviewCleanup).not.toHaveBeenCalled();
  });
});

describe("turning a diffed file change into a review suggestion", () => {
  it("keeps the three kinds apart", () => {
    // The kind picks the action the card offers. A create shown as a delete
    // offers to remove a file that does not exist yet.
    const change = (kind: string) =>
      ({
        kind,
        relativePath: "notes.md",
        originalText: "a",
        newText: "b",
        originalSize: 1,
        newSize: 1,
        previewOmitted: false,
        stale: false,
      }) as never;

    expect(reviewChangeToDraft(change("created")).kind).toBe("create");
    expect(reviewChangeToDraft(change("deleted")).kind).toBe("delete");
    expect(reviewChangeToDraft(change("modified")).kind).toBe("rewrite");
    // Anything the backend adds later is a rewrite rather than a crash.
    expect(reviewChangeToDraft(change("something-new")).kind).toBe("rewrite");
  });
});

describe("finding a suggestion", () => {
  it("searches every message, not just the newest", () => {
    const workspace = {
      chatThread: {
        messages: [
          { id: "m1", suggestions: [suggestion({ id: "old" })] },
          { id: "m2", suggestions: [suggestion({ id: "new" })] },
        ],
      },
    } as never;
    expect(findWorkspaceSuggestion(workspace, "old")).not.toBeNull();
    expect(findWorkspaceSuggestion(workspace, "new")).not.toBeNull();
    expect(findWorkspaceSuggestion(workspace, "missing")).toBeNull();
  });
});
