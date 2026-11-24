import { beforeEach, describe, expect, it, vi } from "vitest";

const { setTheme, reportClientError } = vi.hoisted(() => ({
  setTheme: vi.fn(async (_theme: "light" | "dark" | null) => undefined),
  reportClientError: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTheme }) }));
vi.mock("../runtime/desktopRuntime", () => ({ isTauriRuntime: () => true }));
vi.mock("../diagnostics/errorReporter", () => ({ reportClientError }));

import { syncWindowAppearance } from "./windowChrome";

describe("syncWindowAppearance", () => {
  beforeEach(() => {
    setTheme.mockClear();
    reportClientError.mockClear();
  });

  it("gives the native window the app's light or dark, and hands it back to the Mac for Match Mac", async () => {
    await syncWindowAppearance("light");
    await syncWindowAppearance("dark");
    await syncWindowAppearance("system");
    expect(setTheme.mock.calls.map(([theme]) => theme)).toEqual(["light", "dark", null]);
  });

  it("logs a refusal instead of throwing", async () => {
    setTheme.mockRejectedValueOnce(new Error("not allowed"));
    await expect(syncWindowAppearance("light")).resolves.toBeUndefined();
    expect(reportClientError).toHaveBeenCalledWith("window-appearance", expect.any(String), expect.stringContaining("not allowed"));
  });
});
