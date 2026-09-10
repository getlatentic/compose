// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const WORKSPACE_ID = "11111111-2222-3333-4444-555555555555";

function payloadFor(overrides: Record<string, unknown> = {}) {
  return {
    workspaces: {
      activeWorkspaceId: WORKSPACE_ID,
      onboarding: { completedAt: 1700000000000 },
      workspaces: [
        {
          id: WORKSPACE_ID,
          name: "Notes",
          path: "/vault",
          tabs: { activeFilePath: "note.md", openFilePaths: ["note.md"] },
        },
      ],
    },
    files: [
      { relativePath: "note.md", lastModifiedMs: 10, sizeBytes: 6 },
      { relativePath: "other.md", lastModifiedMs: 20, sizeBytes: 7 },
    ],
    activeFile: {
      workspaceId: WORKSPACE_ID,
      relativePath: "note.md",
      content: "# Note",
      lastModifiedMs: 10,
    },
    externalFiles: null,
    ...overrides,
  };
}

async function seedFrom(payload: unknown) {
  vi.resetModules();
  (window as { __COMPOSE_BOOT__?: unknown }).__COMPOSE_BOOT__ = payload;
  return import("./bootPayload");
}

afterEach(() => {
  delete (window as { __COMPOSE_BOOT__?: unknown }).__COMPOSE_BOOT__;
});

describe("the launch payload", () => {
  it("seeds the tree and the open document, not just the workspace list", async () => {
    const { bootSeed } = await seedFrom(payloadFor());

    const seed = bootSeed();

    expect(seed.activeWorkspaceId).toBe(WORKSPACE_ID);
    const active = seed.workspaces?.find((workspace) => workspace.id === WORKSPACE_ID);
    expect(active?.files.map((entry) => entry.relativePath)).toEqual(["note.md", "other.md"]);
    expect(active?.activeFilePath).toBe("note.md");
    expect(active?.fileContents["note.md"]?.content).toBe("# Note");
  });

  it("keeps the loose workspace last, so external files still have a home", async () => {
    const { bootSeed } = await seedFrom(
      payloadFor({
        externalFiles: {
          files: [{ path: "/elsewhere/draft.md", addedAtMs: 1 }],
          openPaths: ["/elsewhere/draft.md"],
          activePath: "/elsewhere/draft.md",
        },
      }),
    );

    const workspaces = bootSeed().workspaces ?? [];

    const loose = workspaces[workspaces.length - 1];
    expect(loose?.kind).toBe("loose");
    expect(loose?.files.map((entry) => entry.relativePath)).toEqual(["/elsewhere/draft.md"]);
  });

  it("declines a document the tabs have since moved off", async () => {
    const { bootSeed } = await seedFrom(
      payloadFor({
        activeFile: {
          workspaceId: WORKSPACE_ID,
          relativePath: "stale.md",
          content: "old",
          lastModifiedMs: 1,
        },
      }),
    );

    const active = bootSeed().workspaces?.find((workspace) => workspace.id === WORKSPACE_ID);

    expect(active?.fileContents).toEqual({});
  });

  it("ignores a payload with no workspace list rather than seeding half a store", async () => {
    const { bootPayload, bootSeed } = await seedFrom({ files: [] });

    expect(bootPayload()).toBeNull();
    expect(bootSeed()).toEqual({});
  });

  it("seeds nothing when the launch carried no payload at all", async () => {
    const { bootPayload, bootSeed } = await seedFrom(undefined);

    expect(bootPayload()).toBeNull();
    expect(bootSeed()).toEqual({});
  });
});
