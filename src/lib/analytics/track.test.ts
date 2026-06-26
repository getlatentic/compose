import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted so vi.mock (itself hoisted) can reference the spy without a TDZ error.
const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn((_cmd: string, _args?: unknown): Promise<void> => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { trackAppLaunch } from "./track";

describe("trackAppLaunch", () => {
  afterEach(() => invoke.mockClear());

  it("does not fire when the user has opted out", () => {
    trackAppLaunch(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes the aptabase track_event command once when enabled (idempotent)", () => {
    trackAppLaunch(true);
    trackAppLaunch(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("plugin:aptabase|track_event", {
      name: "app_launched",
      props: null,
    });
  });
});
