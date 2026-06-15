import { describe, expect, it } from "vitest";
import { cancelHarnessRun, runHarnessStream, subscribeHarnessRun } from "./harnessClient";

describe("harnessClient runtime boundary", () => {
  it("does not simulate Bob outside the Tauri desktop runtime", async () => {
    await expect(
      runHarnessStream({
        approvalMode: "default",
        chatMode: "plan",
        contextFilePaths: [],
        maxCoins: 200,
        prompt: "hello",
        runId: "run-browser",
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("Tauri desktop runtime");
  });

  it("does not expose fake subscriptions or cancellation outside desktop", async () => {
    await expect(subscribeHarnessRun("run-browser", () => undefined)).rejects.toThrow(
      "Tauri desktop runtime",
    );
    await expect(cancelHarnessRun("run-browser")).rejects.toThrow("Tauri desktop runtime");
  });
});
