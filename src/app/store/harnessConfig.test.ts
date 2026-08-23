// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  editGuardFor,
  harnessExtraArgs,
  loadHarnessPrefs,
  persistHarnessPrefs,
  HARNESS_PREFS_KEY,
  supportsPermissionMode,
  type HarnessPrefs,
} from "./harnessConfig";
import type { HarnessCapabilities } from "../../lib/ipc/harnessClient";

function caps(over: Partial<HarnessCapabilities> = {}): HarnessCapabilities {
  return {
    credentialRequired: false,
    previewsEdits: false,
    models: [],
    customModel: false,
    effort: false,
    maxTurns: false,
    login: false,
    customInstructions: false,
    ...over,
  };
}

describe("which guard stands between an agent and the user's files", () => {
  it("covers every combination, because the wrong one edits real files unguarded", () => {
    // Three inputs, eight cases, and the cost of a wrong cell is the agent
    // writing to the workspace with nothing recording what it changed.
    const table: Array<[boolean, boolean, boolean, string]> = [
      // previewsEdits, allowEdits, reviewEdits → guard
      [true, true, true, "none"],
      [true, true, false, "none"],
      [true, false, true, "none"],
      [true, false, false, "none"],
      [false, false, true, "none"],
      [false, false, false, "none"],
      [false, true, true, "clone"],
      [false, true, false, "snapshot"],
    ];
    for (const [previewsEdits, allowEdits, reviewEdits, expected] of table) {
      expect(
        editGuardFor(caps({ previewsEdits }), allowEdits, reviewEdits),
        `previewsEdits=${previewsEdits} allowEdits=${allowEdits} reviewEdits=${reviewEdits}`,
      ).toBe(expected);
    }
  });

  it("does not guard a harness that reviews its own edits", () => {
    // It proposes changes for approval, so wrapping it in a sandbox would ask
    // the user to approve the same edit twice.
    expect(editGuardFor(caps({ previewsEdits: true }), true, true)).toBe("none");
  });

  it("guards nothing in a read-only run", () => {
    // Nothing can be written, so building a sandbox copy is pure cost.
    expect(editGuardFor(caps(), false, true)).toBe("none");
  });
});

describe("permission flags on the command line", () => {
  it("gives Claude a default mode and leaves other agents alone", () => {
    // Without it Claude stops on every action and the run appears hung; passing
    // it to an agent that has no such flag makes the CLI reject the argv.
    expect(harnessExtraArgs("claude", {})).toEqual(["--permission-mode", "bypassPermissions"]);
    expect(harnessExtraArgs("codex", {})).toEqual([]);
    expect(harnessExtraArgs("ollama", {})).toEqual([]);
  });

  it("lets an explicit choice override the default", () => {
    expect(harnessExtraArgs("claude", { permissionMode: "acceptEdits" })).toEqual([
      "--permission-mode",
      "acceptEdits",
    ]);
  });

  it("offers the control only where the flag exists", () => {
    expect(supportsPermissionMode("claude")).toBe(true);
    expect(supportsPermissionMode("codex")).toBe(false);
  });
});

describe("remembering the user's agent settings", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips what was saved", () => {
    const prefs: HarnessPrefs = {
      selectedHarnessId: "codex",
      allowEdits: false,
      reviewEdits: true,
      customInstructions: "be terse",
      harnessOptions: { claude: { permissionMode: "acceptEdits" } },
    };
    persistHarnessPrefs(prefs);
    expect(loadHarnessPrefs()).toEqual(prefs);
  });

  it("leaves the agent unset on a fresh install", () => {
    // Boot derives one from the first ready agent; a hardcoded default would
    // point a new user at something they have not installed.
    expect(loadHarnessPrefs().selectedHarnessId).toBe("");
  });

  it("ignores a stored value of the wrong type instead of adopting it", () => {
    // Anything can end up in localStorage — an older build, a hand edit. A
    // string where a boolean belongs would make `allowEdits` truthy forever.
    localStorage.setItem(
      HARNESS_PREFS_KEY,
      JSON.stringify({ selectedHarnessId: 42, allowEdits: "yes", reviewEdits: null }),
    );
    const prefs = loadHarnessPrefs();
    expect(prefs.selectedHarnessId).toBe("");
    expect(prefs.allowEdits).toBe(true);
    expect(prefs.reviewEdits).toBe(false);
  });

  it("keeps the storage key it has always used", () => {
    // Renaming it does not fail anything — it silently resets every existing
    // user's agent choice and edit permission on their next launch.
    expect(HARNESS_PREFS_KEY).toBe("compose.harnessPrefs");
  });

  it("survives a corrupt entry rather than failing the boot", () => {
    localStorage.setItem(HARNESS_PREFS_KEY, "{not json");
    expect(loadHarnessPrefs().selectedHarnessId).toBe("");
  });
});
