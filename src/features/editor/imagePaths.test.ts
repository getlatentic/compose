import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURIComponent(p)}`),
}));
vi.mock("../../lib/runtime/desktopRuntime", () => ({
  isTauriRuntime: vi.fn(() => true),
}));

import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { imageWritePath, resolveDisplaySrc } from "./imagePaths";

const tauri = vi.mocked(isTauriRuntime);
const convert = vi.mocked(convertFileSrc);

afterEach(() => {
  tauri.mockReturnValue(true);
  convert.mockClear();
});

describe("resolveDisplaySrc", () => {
  const ctx = { fileDir: "/ws" };

  it("passes through anything that already carries a scheme", () => {
    for (const src of [
      "data:image/png;base64,AAAA",
      "http://example.com/y.png",
      "https://example.com/y.png",
      "asset://localhost/x",
      "blob:abc",
      "file:///x.png",
      "//cdn/x.png",
      "#fragment",
    ]) {
      expect(resolveDisplaySrc(src, ctx)).toBe(src);
    }
    expect(convert).not.toHaveBeenCalled();
  });

  it("resolves a relative ref against the file dir into an asset URL (desktop)", () => {
    const out = resolveDisplaySrc("images/a.png", ctx);
    expect(convert).toHaveBeenCalledWith("/ws/images/a.png");
    expect(out).toBe(`asset://localhost/${encodeURIComponent("/ws/images/a.png")}`);
  });

  it("resolves relative to the active file's subdirectory", () => {
    resolveDisplaySrc("a.png", { fileDir: "/ws/sub" });
    expect(convert).toHaveBeenCalledWith("/ws/sub/a.png");
  });

  it("converts an absolute local path directly", () => {
    resolveDisplaySrc("/abs/a.png", ctx);
    expect(convert).toHaveBeenCalledWith("/abs/a.png");
  });

  it("passes relative refs through unchanged in the browser (no asset protocol)", () => {
    tauri.mockReturnValue(false);
    expect(resolveDisplaySrc("images/a.png", ctx)).toBe("images/a.png");
    expect(convert).not.toHaveBeenCalled();
  });

  it("passes through when there is no file directory", () => {
    expect(resolveDisplaySrc("images/a.png", { fileDir: null })).toBe("images/a.png");
    expect(convert).not.toHaveBeenCalled();
  });

  it("leaves an empty src empty", () => {
    expect(resolveDisplaySrc("", ctx)).toBe("");
  });
});

describe("where a pasted image is written", () => {
  // The editor computes this itself: dirname(join(workspaceRoot, filePath)).
  // Reproduced rather than imported so the test fails if either side moves.
  function editorFileDir(workspaceRoot: string, docPath: string): string {
    const full = `${workspaceRoot}/${docPath}`;
    return full.slice(0, full.lastIndexOf("/"));
  }

  it("keeps a root document's images where they already are", () => {
    expect(imageWritePath("Compose Bugs.md", "images/pasted-x.png")).toBe("images/pasted-x.png");
  });

  it("puts a subfolder document's images beside it", () => {
    expect(imageWritePath("Courses/Tonative/untitled-1.md", "images/pasted-x.png")).toBe(
      "Courses/Tonative/images/pasted-x.png",
    );
  });

  it("writes to the path the editor will look in, at any depth", () => {
    // The bug this covers: bytes landed at <root>/images while the editor
    // resolved the reference against the document's own directory, so every
    // note outside the workspace root referenced an image that was never
    // written there. Nothing errored — the reference was inserted because the
    // write succeeded, just not where the reference pointed.
    const root = "/vault";
    const relPath = "images/pasted-x.png";
    for (const doc of ["note.md", "Courses/untitled-1.md", "Courses/Tonative/untitled-1.md"]) {
      const written = `${root}/${imageWritePath(doc, relPath)}`;
      const readBack = `${editorFileDir(root, doc)}/${relPath}`;
      expect(written).toBe(readBack);
    }
  });
});
