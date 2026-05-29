import { beforeEach, describe, expect, it } from "vitest";
import {
  FileConflictError,
  _resetFallbackForTests,
  createFile,
  deleteFile,
  readFile,
  renameFile,
  scanWorkspace,
  writeFile,
} from "./filesClient";

const workspaceId = "workspace-test";

beforeEach(() => {
  _resetFallbackForTests();
});

describe("filesClient browser fallback", () => {
  it("scan returns the seeded files for a new workspace", async () => {
    const entries = await scanWorkspace(workspaceId);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.relativePath.endsWith(".md"))).toBe(true);
    expect(entries).toEqual(
      [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    );
  });

  it("write updates the file and bumps lastModifiedMs", async () => {
    const entries = await scanWorkspace(workspaceId);
    const target = entries[0].relativePath;
    const initial = await readFile(workspaceId, target);

    await new Promise((resolve) => setTimeout(resolve, 1));
    const written = await writeFile(workspaceId, target, "updated", initial.lastModifiedMs);
    expect(written.lastModifiedMs).toBeGreaterThanOrEqual(initial.lastModifiedMs);

    const reread = await readFile(workspaceId, target);
    expect(reread.content).toBe("updated");
  });

  it("write rejects with FileConflictError when expected mtime is stale", async () => {
    const entries = await scanWorkspace(workspaceId);
    const target = entries[0].relativePath;

    await new Promise((resolve) => setTimeout(resolve, 1));
    await writeFile(workspaceId, target, "first revision", null);

    await expect(writeFile(workspaceId, target, "second revision", 0)).rejects.toBeInstanceOf(
      FileConflictError,
    );
  });

  it("create rejects when a file with the same path already exists", async () => {
    await createFile(workspaceId, "notes/new.md", "# New");
    await expect(createFile(workspaceId, "notes/new.md", "# Dup")).rejects.toThrow();
  });

  it("rename moves the file and preserves its content", async () => {
    await createFile(workspaceId, "notes/source.md", "# Source");
    await renameFile(workspaceId, "notes/source.md", "notes/renamed.md");

    await expect(readFile(workspaceId, "notes/source.md")).rejects.toThrow();
    const renamed = await readFile(workspaceId, "notes/renamed.md");
    expect(renamed.content).toBe("# Source");
  });

  it("delete removes the file from the workspace", async () => {
    await createFile(workspaceId, "notes/tmp.md", "# Tmp");
    await deleteFile(workspaceId, "notes/tmp.md");
    await expect(readFile(workspaceId, "notes/tmp.md")).rejects.toThrow();
  });
});
