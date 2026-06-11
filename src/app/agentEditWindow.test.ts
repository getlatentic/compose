import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetAgentEditWindows,
  beginAgentEditWindow,
  endAgentEditWindow,
  isAgentEditActive,
} from "./agentEditWindow";

describe("agentEditWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetAgentEditWindows();
  });

  afterEach(() => {
    __resetAgentEditWindows();
    vi.useRealTimers();
  });

  it("is inactive for an unknown workspace", () => {
    expect(isAgentEditActive("ws-unknown")).toBe(false);
  });

  it("is active while a run is in flight", () => {
    beginAgentEditWindow("ws");
    expect(isAgentEditActive("ws")).toBe(true);
  });

  it("stays active through the grace window after a run finishes, then clears", () => {
    beginAgentEditWindow("ws");
    endAgentEditWindow("ws");

    // Still active immediately after — the watcher's trailing events for the
    // agent's last writes land here.
    expect(isAgentEditActive("ws")).toBe(true);

    // …and after the grace window elapses it goes inactive (external edits
    // conflict again).
    vi.advanceTimersByTime(2_000);
    expect(isAgentEditActive("ws")).toBe(false);
  });

  it("a fresh run supersedes the prior run's grace tail", () => {
    beginAgentEditWindow("ws");
    endAgentEditWindow("ws"); // grace window opens
    beginAgentEditWindow("ws"); // new run — cancels the grace tail, fully active
    expect(isAgentEditActive("ws")).toBe(true);

    // The superseded grace timer must not flip us inactive while the new run runs.
    vi.advanceTimersByTime(5_000);
    expect(isAgentEditActive("ws")).toBe(true);

    endAgentEditWindow("ws");
    vi.advanceTimersByTime(2_000);
    expect(isAgentEditActive("ws")).toBe(false);
  });

  it("stays active until every concurrent run finishes (refcounted)", () => {
    beginAgentEditWindow("ws");
    beginAgentEditWindow("ws");
    endAgentEditWindow("ws");
    // One run still in flight — fully active, no grace involved yet.
    expect(isAgentEditActive("ws")).toBe(true);

    endAgentEditWindow("ws");
    expect(isAgentEditActive("ws")).toBe(true); // now in grace
    vi.advanceTimersByTime(2_000);
    expect(isAgentEditActive("ws")).toBe(false);
  });

  it("an unbalanced end (no open run) does not flip an inactive window active", () => {
    endAgentEditWindow("ws");
    expect(isAgentEditActive("ws")).toBe(false);
  });

  it("tracks windows per workspace independently", () => {
    beginAgentEditWindow("ws-a");
    expect(isAgentEditActive("ws-a")).toBe(true);
    expect(isAgentEditActive("ws-b")).toBe(false);
  });
});
