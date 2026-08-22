import { describe, expect, it } from "vitest";

import type { WorkspaceChatMessage, WorkspaceChatThread } from "../workspaceModel";
import { handleHarnessRunEvent, persistedRunBody } from "./runEvents";

function thread(messages: WorkspaceChatMessage[] = []): WorkspaceChatThread {
  return {
    activeLlmThreadId: null,
    activeRunId: null,
    conversationId: null,
    contextItems: [],
    messages,
    preparedCommand: null,
    prompt: "",
    runError: null,
    runState: "idle",
  };
}

function assistant(runId: string, content: string): WorkspaceChatMessage {
  return { activity: null, content, id: `m-${runId}`, role: "assistant", runId } as WorkspaceChatMessage;
}

describe("what a finished run leaves in the transcript", () => {
  it("keeps the answer even when the run was stopped or failed", () => {
    // The ordering is the whole point. A user who reads a reply and then hits
    // Stop must not watch it be replaced by "Run cancelled" — the answer is
    // the thing they wanted, and it is already on screen.
    const withAnswer = thread([assistant("r1", "Here is the summary.")]);

    expect(persistedRunBody(withAnswer, "r1", { cancelled: true })).toEqual({
      body: "Here is the summary.",
      role: "assistant",
    });
    expect(persistedRunBody(withAnswer, "r1", { errorMessage: "stream broke" })).toEqual({
      body: "Here is the summary.",
      role: "assistant",
    });
    expect(persistedRunBody(withAnswer, "r1", { exitCode: 1 })).toEqual({
      body: "Here is the summary.",
      role: "assistant",
    });
  });

  it("explains an empty run rather than persisting nothing", () => {
    // With no answer, the transcript would otherwise end on the user's message
    // with no sign of what happened.
    const empty = thread();
    expect(persistedRunBody(empty, "r1", { cancelled: true })).toEqual({
      body: "Run cancelled",
      role: "system",
    });
    expect(persistedRunBody(empty, "r1", { errorMessage: "spawn failed" })).toEqual({
      body: "spawn failed",
      role: "system",
    });
    expect(persistedRunBody(empty, "r1", { exitCode: 3 })).toEqual({
      body: "The assistant exited with code 3",
      role: "system",
    });
  });

  it("says nothing when a run simply finished with nothing to say", () => {
    // Exit 0 and no answer is not an error, so it must not write a system
    // message into the transcript.
    expect(persistedRunBody(thread(), "r1", { exitCode: 0 })).toBeNull();
    expect(persistedRunBody(thread(), "r1", {})).toBeNull();
  });

  it("a cancel outranks an error, so one stop reads as one thing", () => {
    // Cancelling often *causes* a stream error. Reporting the error would tell
    // the user their run broke when they stopped it themselves.
    expect(
      persistedRunBody(thread(), "r1", { cancelled: true, errorMessage: "stream closed" }),
    ).toEqual({ body: "Run cancelled", role: "system" });
  });

  it("only reads the answer belonging to this run", () => {
    // Threads outlive runs. Picking up a previous run's reply would persist a
    // stale answer as this run's result.
    const earlier = thread([assistant("r0", "An older reply.")]);
    expect(persistedRunBody(earlier, "r1", { cancelled: true })).toEqual({
      body: "Run cancelled",
      role: "system",
    });
  });
});

describe("run event routing", () => {
  it("ignores events belonging to another run", () => {
    // Two runs can be in flight across workspaces. A handler that applied a
    // foreign event would write one run's output into another's transcript.
    let updates = 0;
    let finalized = 0;
    handleHarnessRunEvent(
      { kind: "text", runId: "other", delta: "not mine" } as never,
      "mine",
      () => {
        updates += 1;
      },
      () => {
        finalized += 1;
      },
    );
    expect(updates).toBe(0);
    expect(finalized).toBe(0);
  });
});
