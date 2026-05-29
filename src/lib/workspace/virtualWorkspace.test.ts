import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetVirtualWorkspaceForTests,
  _setWorkspacePersistenceForTests,
  vwImport,
  vwRead,
  vwScan,
  vwWrite,
} from "./virtualWorkspace";
import type { PersistedFile, WorkspacePersistence } from "./workspacePersistence";

/**
 * In-memory stand-in for OPFS, so the persistence contract (hydrate +
 * write-through + import-replaces) is testable in Node without a browser.
 * `_resetVirtualWorkspaceForTests` clears only the in-memory hot tier,
 * leaving this backend intact — which is exactly a browser *reload*.
 */
class FakePersistence implements WorkspacePersistence {
  readonly store = new Map<string, Map<string, PersistedFile>>();

  async load(workspaceId: string): Promise<Map<string, PersistedFile>> {
    return new Map(this.store.get(workspaceId) ?? new Map());
  }
  async put(workspaceId: string, relativePath: string, file: PersistedFile): Promise<void> {
    let files = this.store.get(workspaceId);
    if (!files) {
      files = new Map();
      this.store.set(workspaceId, files);
    }
    files.set(relativePath, { ...file });
  }
  async remove(workspaceId: string, relativePath: string): Promise<void> {
    this.store.get(workspaceId)?.delete(relativePath);
  }
  async clear(workspaceId: string): Promise<void> {
    this.store.delete(workspaceId);
  }
}

const workspaceId = "vw-test";
let backend: FakePersistence;

beforeEach(() => {
  _resetVirtualWorkspaceForTests();
  backend = new FakePersistence();
  _setWorkspacePersistenceForTests(backend);
});

describe("virtual workspace persistence", () => {
  it("seeds an empty workspace and persists the seed", async () => {
    const entries = await vwScan(workspaceId);
    expect(entries.length).toBeGreaterThan(0);
    expect(backend.store.get(workspaceId)?.size).toBe(entries.length);
  });

  it("survives a reload: a written file is restored from persistence", async () => {
    await vwWrite(workspaceId, "notes/keep.md", "# Keep me", null);

    // Simulate a browser reload: drop the in-memory tier, keep persistence.
    _resetVirtualWorkspaceForTests();
    _setWorkspacePersistenceForTests(backend);

    const restored = await vwRead(workspaceId, "notes/keep.md");
    expect(restored.content).toBe("# Keep me");
  });

  it("import replaces the workspace and persists the imported files", async () => {
    await vwImport(workspaceId, [
      { content: "# Imported A", relativePath: "a.md" },
      { content: "# Imported B", relativePath: "sub/b.md" },
    ]);

    const paths = (await vwScan(workspaceId)).map((entry) => entry.relativePath);
    expect(paths).toEqual(["a.md", "sub/b.md"]); // seed gone, only imported files

    _resetVirtualWorkspaceForTests();
    _setWorkspacePersistenceForTests(backend);
    expect((await vwRead(workspaceId, "sub/b.md")).content).toBe("# Imported B");
  });
});
