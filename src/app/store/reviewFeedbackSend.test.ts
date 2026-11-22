import { beforeEach, describe, expect, it, vi } from "vitest";

import { runHarnessStream } from "../../lib/ipc/harnessClient";
import { recordLlmThread } from "../../lib/ipc/llmContextClient";
import { _resetFallbackConversationsForTests } from "../../lib/ipc/conversationsClient";
import { reviewBlockKeys } from "../../features/review/liveBlocks";
import { useWorkspaceStore } from "../workspaceStore";
import { useHarnessStore } from "./harnessStore";
import { useUiStore } from "./uiStore";
import { updateWorkspace } from "./internals";

vi.mock("../../lib/ipc/llmContextClient", () => ({
  appendLlmMessage: vi.fn(() => Promise.resolve()),
  recordLlmThread: vi.fn(),
}));

vi.mock("../../lib/ipc/workspaceClient", () => ({
  switchWorkspace: vi.fn(() => Promise.resolve()),
  saveWorkspaceTabs: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../lib/ipc/harnessClient", () => ({
  cancelHarnessRun: vi.fn(),
  runHarnessStream: vi.fn(),
  subscribeHarnessRun: vi.fn(async () => () => undefined),
  harnessCredentialStatus: vi.fn(async () => ({ configured: true })),
}));

const BEFORE = "Braun and Clarke describe thematic analysis.\n";
const AFTER = "Braun and Clarke (2006) describe thematic analysis.\n";
const [YEAR_KEY] = reviewBlockKeys({ original: BEFORE, proposed: AFTER });
const NOTE_LINE = 'you had added "(2006)" after "Braun and Clarke"';

/** A workspace whose last agent turn added "(2006)" to the open note. */
function seedWorkspaceWithAppliedChange(): string {
  const id = useWorkspaceStore.getState().addWorkspace("/tmp/feedback-vault");
  useWorkspaceStore.setState((state) => ({
    workspaces: updateWorkspace(state.workspaces, id, (item) => ({
      ...item,
      activeFilePath: "Slip Box review.md",
      chatThread: {
        ...item.chatThread,
        messages: [
          { id: "u1", role: "user", content: "Add the year.", activity: null },
          {
            id: "a1",
            role: "assistant",
            content: "Added it.",
            activity: null,
            runId: "run-1",
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
              },
            ],
          },
        ],
      },
    })),
  }));
  return id;
}

/** The previous run's events never arrive here: let the next send start. */
function settleRun(id: string): void {
  useWorkspaceStore.setState((state) => ({
    workspaces: updateWorkspace(state.workspaces, id, (item) => ({
      ...item,
      chatThread: { ...item.chatThread, activeRunId: null, runState: "idle" },
    })),
  }));
}

function sentPrompt(call: number): string {
  return vi.mocked(runHarnessStream).mock.calls[call][0].prompt;
}

describe("telling the agent what the writer undid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFallbackConversationsForTests();
    vi.mocked(recordLlmThread).mockResolvedValue({ llmThreadId: "llm-1" });
    useWorkspaceStore.setState({ activeWorkspaceId: null, conversations: {}, workspaces: [] });
    useUiStore.setState({ chatOpen: true, settingsOpen: false });
    useHarnessStore.setState({ harnessCatalog: [], harnessOptions: {}, allowEdits: true, selectedHarnessId: "claude" });
  });

  it("sends the undo with the next message, then not again", async () => {
    const id = seedWorkspaceWithAppliedChange();
    useWorkspaceStore.getState().decideReviewBlock("c1", YEAR_KEY, false);

    useWorkspaceStore.getState().setChatPrompt("Tighten the second sentence.");
    await useWorkspaceStore.getState().sendChatPrompt();
    expect(sentPrompt(0)).toContain(NOTE_LINE);
    expect(sentPrompt(0)).toMatch(/Do not redo these changes unless the writer asks for them\.\n\nTighten the second sentence\.$/);
    const userMessages = useWorkspaceStore.getState().activeWorkspace()?.chatThread.messages.filter((message) => message.role === "user") ?? [];
    expect(userMessages[userMessages.length - 1]?.content).toBe("Tighten the second sentence.");

    settleRun(id);
    useWorkspaceStore.getState().setChatPrompt("And the third.");
    await useWorkspaceStore.getState().sendChatPrompt();
    expect(sentPrompt(1)).not.toContain("the writer took some of your edits back out");
  });

  it("keeps the note for the next try when the run fails to start", async () => {
    const id = seedWorkspaceWithAppliedChange();
    useWorkspaceStore.getState().decideReviewBlock("c1", YEAR_KEY, false);
    vi.mocked(runHarnessStream).mockRejectedValueOnce(new Error("claude not found"));

    useWorkspaceStore.getState().setChatPrompt("Tighten it.");
    await useWorkspaceStore.getState().sendChatPrompt();
    settleRun(id);
    useWorkspaceStore.getState().setChatPrompt("Tighten it.");
    await useWorkspaceStore.getState().sendChatPrompt();

    expect(sentPrompt(1)).toContain(NOTE_LINE);
  });

  it("sends the undo with a comment on a selection too", async () => {
    seedWorkspaceWithAppliedChange();
    useWorkspaceStore.getState().decideReviewBlock("c1", YEAR_KEY, false);

    await useWorkspaceStore
      .getState()
      .askAboutSelectionStream("Is this clear?", { range: { start: 0, end: 16 }, text: "Braun and Clarke" });

    expect(sentPrompt(0)).toContain(NOTE_LINE);
    expect(sentPrompt(0)).toContain("About this excerpt from `Slip Box review.md`");
  });
});
