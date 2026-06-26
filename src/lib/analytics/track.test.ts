import { describe, expect, it, vi } from "vitest";

// Mock the Tauri plugin binding so the gating logic is testable in node.
vi.mock("@aptabase/tauri", () => ({ trackEvent: vi.fn() }));

import { shouldTrack } from "./track";

describe("analytics gating", () => {
  it("tracks only when enabled AND the build is configured", () => {
    expect(shouldTrack({ enabled: true, configured: true })).toBe(true);
    expect(shouldTrack({ enabled: false, configured: true })).toBe(false);
    expect(shouldTrack({ enabled: true, configured: false })).toBe(false);
    expect(shouldTrack({ enabled: false, configured: false })).toBe(false);
  });
});
