import { describe, expect, it, vi } from "vitest";
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

describe("every command is guarded at the runtime boundary", () => {
  it("no exported call reaches IPC outside Tauri", async () => {
    // The browser preview has no Tauri, so `invoke` is not merely unavailable
    // — reaching it throws and takes the surrounding view with it. That makes
    // the guard a property of the whole module rather than of the handful of
    // functions someone remembered to test, and a new command added without
    // one is exactly the case a per-function test cannot see.
    vi.resetModules();
    const invoke = vi.fn(() => {
      throw new Error("IPC attempted outside Tauri");
    });
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));

    const client: Record<string, unknown> = await import("./harnessClient");
    const called: string[] = [];

    for (const [name, value] of Object.entries(client)) {
      if (typeof value !== "function") continue;
      const before = invoke.mock.calls.length;
      // Arguments are deliberately generous: every guard returns before it
      // reads them, so anything shaped roughly right is enough to get there.
      try {
        await (value as (...args: unknown[]) => unknown)("id", "value", {}, () => {});
      } catch {
        // A rejection is fine — an unguarded `invoke` is not.
      }
      if (invoke.mock.calls.length > before) called.push(name);
    }

    expect(called, `these reached IPC with no runtime guard: ${called.join(", ")}`).toEqual([]);
    vi.doUnmock("@tauri-apps/api/core");
  });
});
