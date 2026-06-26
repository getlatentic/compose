import { describe, expect, it } from "vitest";
import {
  cancelHarnessRun,
  runHarnessStream,
  runtimeDetailsOf,
  subscribeHarnessRun,
  type HarnessReadiness,
} from "./harnessClient";

/** A minimal readiness with a given free-form `details`, for the parser tests. */
function readinessWith(details: unknown): HarnessReadiness {
  return {
    harnessId: "claude",
    ready: true,
    installed: true,
    version: "2.0.1",
    authConfigured: true,
    error: null,
    details,
  };
}

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

describe("runtimeDetailsOf", () => {
  it("reads the snake_case resolved_path + install_kind the adapter attaches", () => {
    const details = runtimeDetailsOf(
      readinessWith({
        resolved_path: "/Users/dev/.local/bin/claude",
        install_kind: "native",
      }),
    );
    expect(details).toEqual({
      resolvedPath: "/Users/dev/.local/bin/claude",
      installKind: "native",
    });
  });

  it("degrades to nulls when details is absent (harness build predates the change)", () => {
    expect(runtimeDetailsOf(readinessWith(null))).toEqual({
      resolvedPath: null,
      installKind: null,
    });
    expect(runtimeDetailsOf(null)).toEqual({ resolvedPath: null, installKind: null });
  });

  it("ignores an unrecognized install_kind but still surfaces the path", () => {
    const details = runtimeDetailsOf(
      readinessWith({ resolved_path: "/opt/x/claude", install_kind: "snap" }),
    );
    expect(details).toEqual({ resolvedPath: "/opt/x/claude", installKind: null });
  });

  it("tolerates a non-object details without throwing", () => {
    expect(runtimeDetailsOf(readinessWith("oops"))).toEqual({
      resolvedPath: null,
      installKind: null,
    });
    expect(runtimeDetailsOf(readinessWith({ resolved_path: 42 }))).toEqual({
      resolvedPath: null,
      installKind: null,
    });
  });
});
