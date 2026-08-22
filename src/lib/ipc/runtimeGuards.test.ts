import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Modules that deliberately let the call reach `invoke` and reject.
 *
 * Verified rather than assumed: outside Tauri `invoke` returns a *rejected
 * promise*, not a synchronous throw, so an awaiting caller can catch it. That
 * is the whole basis for the exemption — if it ever threw synchronously, a
 * non-awaiting call site would take the view down.
 */
/**
 * Modules with an export that deliberately reaches `invoke` outside Tauri,
 * with the reason it is safe there.
 *
 * The premise was verified rather than assumed: outside Tauri `invoke` returns
 * a *rejected promise*, not a synchronous throw, so an awaiting caller can
 * catch it. If that ever changed, a non-awaiting call site would take the view
 * down and every entry here would become a bug.
 */
const UNGUARDED_BY_DESIGN: Record<string, string> = {
  "defaultHandlerClient.ts":
    "LaunchServices is macOS-only, so the command rejects off-macOS too; callers " +
    "treat a rejection as 'unavailable' and hide the affordance",
  "filesClient.ts":
    "`invokeFile` is an exported helper, not a command — every command that " +
    "routes through it guards first",
  "externalFilesClient.ts":
    "the entry points (`externalList`, `externalSaveTabs`) guard; the rest are " +
    "reachable only once an external file exists, which the browser preview " +
    "never has",
};

const CLIENTS = [
  "appClient.ts",
  "commentsClient.ts",
  "conversationsClient.ts",
  "conversationsFallback.ts",
  "defaultHandlerClient.ts",
  "exportClient.ts",
  "externalFilesClient.ts",
  "fileWatcherClient.ts",
  "filesClient.ts",
  "harnessClient.ts",
  "historyClient.ts",
  "indexClient.ts",
  "llmContextClient.ts",
  "reviewClient.ts",
  "systemClient.ts",
  "updater.ts",
  "workspaceClient.ts",
];

beforeEach(() => vi.resetModules());

describe("the desktop-runtime boundary, across every IPC client", () => {
  it("no command reaches IPC outside Tauri unless it is documented to", async () => {
    // The browser preview has no Tauri. A command that calls `invoke` there
    // rejects, which is fine only where the caller expects it — everywhere else
    // it surfaces as an unhandled rejection in a view that should simply have
    // rendered nothing. Enumerating the modules is what catches a *new* client
    // added without a guard; a per-module test only covers what someone
    // remembered to write.
    const offenders: string[] = [];

    for (const file of CLIENTS) {
      vi.resetModules();
      const invoke = vi.fn(() => {
        throw new Error("IPC");
      });
      vi.doMock("@tauri-apps/api/core", () => ({ invoke }));

      const mod: Record<string, unknown> = await import(`./${file.replace(/\.ts$/, "")}`);
      for (const value of Object.values(mod)) {
        if (typeof value !== "function") continue;
        try {
          await (value as (...args: unknown[]) => unknown)("id", "value", {}, () => {});
        } catch {
          // A rejection is fine; an unguarded `invoke` is what we are counting.
        }
      }
      if (invoke.mock.calls.length > 0) offenders.push(file);
      vi.doUnmock("@tauri-apps/api/core");
    }

    const documented = Object.keys(UNGUARDED_BY_DESIGN).sort();
    expect(
      offenders.sort(),
      "a client reached IPC with no runtime guard; guard it, or add it to " +
        "UNGUARDED_BY_DESIGN with the reason it is safe",
    ).toEqual(documented);
  });
});
