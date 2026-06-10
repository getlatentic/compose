import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkBobInstall, getBobAuthStatus, setBobApiKey, verifyBobRuntime } from "./settingsClient";

/**
 * settingsClient has two modes: Tauri IPC (desktop) and browser-dev
 * (POSTs/GETs `/api/bob/*` through the Vite proxy). In vitest we run
 * the browser-dev branch — there's no Tauri, so `isTauriRuntime()`
 * is false and the functions exercise the SSE-proxy adapters.
 *
 * The tests mock `fetch` to validate two slices:
 *   1. Proxy unreachable → friendly fallback errors.
 *   2. Proxy returns a real snapshot → adapter shape is correct
 *      (and propagates Node-version diagnostics).
 *
 * The Tauri-side path is exercised separately via the Rust IPC
 * tests; we don't double-mock `@tauri-apps/api/core` here.
 */
describe("settingsClient runtime boundary", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("when the Vite proxy is unreachable", () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    });

    it("returns a friendly auth-status fallback", async () => {
      await expect(getBobAuthStatus()).resolves.toEqual({
        configured: false,
        errorMessage: "Could not reach the bob proxy.",
      });
    });

    it("returns a friendly install-status fallback", async () => {
      await expect(checkBobInstall()).resolves.toEqual({
        errorMessage: "Could not reach the bob proxy.",
        installed: false,
      });
    });
  });

  describe("when the Vite proxy answers", () => {
    function mockSnapshot(snapshot: unknown) {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(snapshot),
      } as Response);
    }

    it("reports configured auth when the snapshot says so", async () => {
      mockSnapshot({
        auth: { configured: true, source: "env" },
        bob: { installed: true, version: "1.0.4", path: "/usr/local/bin/bob", error: null },
        node: { installed: true, version: "v22.15.0", satisfiesMin: true, minVersion: "22.15.0" },
        npm: { installed: true, version: "10.7.0" },
        ready: true,
      });
      await expect(getBobAuthStatus()).resolves.toEqual({ configured: true });
    });

    it("surfaces the Node-version diagnostic when bob is missing because Node is too old", async () => {
      mockSnapshot({
        auth: { configured: true, source: "env" },
        bob: { installed: false, version: null, path: null, error: "bob CLI not found on PATH" },
        node: { installed: true, version: "v18.20.0", satisfiesMin: false, minVersion: "22.15.0" },
        npm: { installed: true, version: "10.7.0" },
        ready: false,
      });
      const result = await checkBobInstall();
      expect(result.installed).toBe(false);
      expect(result.nodeVersion).toBe("v18.20.0");
      expect(result.nodeSatisfies).toBe(false);
      expect(result.nodeMinVersion).toBe("22.15.0");
      expect(result.errorMessage).toContain("22.15.0");
      expect(result.errorMessage).toContain("v18.20.0");
    });

    it("populates path + version when bob is installed", async () => {
      mockSnapshot({
        auth: { configured: true, source: "env" },
        bob: { installed: true, version: "1.0.4", path: "/Users/me/.nvm/.../bob", error: null },
        node: { installed: true, version: "v22.15.0", satisfiesMin: true, minVersion: "22.15.0" },
        npm: { installed: true, version: "10.7.0" },
        ready: true,
      });
      const result = await checkBobInstall();
      expect(result).toMatchObject({
        installed: true,
        version: "1.0.4",
        path: "/Users/me/.nvm/.../bob",
        nodeSatisfies: true,
      });
      expect(result.errorMessage).toBeUndefined();
    });
  });

  describe("desktop-only operations", () => {
    it("still refuses verifyBobRuntime outside Tauri", async () => {
      await expect(verifyBobRuntime()).resolves.toEqual({
        authenticated: false,
        errorMessage: "Bob credentials and CLI checks require the Tauri desktop runtime.",
        installed: false,
        requiresDesktopRuntime: true,
      });
    });

    // setBobApiKey in browser-dev POSTs to `/api/bob/key`, which
    // writes to the OS keychain server-side. The Tauri path is
    // exercised via the Rust IPC tests.
  });

  describe("setBobApiKey in browser-dev", () => {
    it("POSTs the key to the proxy and returns configured=true on success", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, configured: true, source: "keychain" }),
      } as Response);
      globalThis.fetch = fetchMock;

      const result = await setBobApiKey("bob_prod_test_key");
      expect(result.configured).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/bob/key",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ apiKey: "bob_prod_test_key" }),
        }),
      );
    });

    it("surfaces the proxy's error message when saving fails", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Keychain locked" }),
      } as Response);
      await expect(setBobApiKey("anything")).rejects.toThrow("Keychain locked");
    });
  });
});
