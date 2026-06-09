import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURIComponent(p)}`),
}));
vi.mock("../../lib/runtime/desktopRuntime", () => ({
  isTauriRuntime: vi.fn(() => true),
}));

import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import {
  computeFileDir,
  dirnamePath,
  isAbsolutePath,
  joinPath,
  resolveDisplaySrc,
} from "./imageSrcResolver";

const tauri = vi.mocked(isTauriRuntime);
const convert = vi.mocked(convertFileSrc);

afterEach(() => {
  tauri.mockReturnValue(true);
  convert.mockClear();
});

describe("path helpers", () => {
  it("joinPath normalizes '.' and '..' segments", () => {
    expect(joinPath("/ws", "images/a.png")).toBe("/ws/images/a.png");
    expect(joinPath("/ws", "./images/a.png")).toBe("/ws/images/a.png");
    expect(joinPath("/ws/sub", "../images/a.png")).toBe("/ws/images/a.png");
    expect(joinPath("/ws/a/b", "../../images/a.png")).toBe("/ws/images/a.png");
  });

  it("joinPath keeps an absolute root and never lets '..' rise above it", () => {
    expect(joinPath("/", "../../etc/passwd")).toBe("/etc/passwd");
  });

  it("dirnamePath returns the parent directory", () => {
    expect(dirnamePath("/ws/sub/note.md")).toBe("/ws/sub");
    expect(dirnamePath("/ws/note.md")).toBe("/ws");
    expect(dirnamePath("/note.md")).toBe("/");
    expect(dirnamePath("note.md")).toBe(".");
  });

  it("isAbsolutePath distinguishes absolute from relative", () => {
    expect(isAbsolutePath("/ws")).toBe(true);
    expect(isAbsolutePath("images/a.png")).toBe(false);
  });
});

describe("computeFileDir", () => {
  it("is null without a workspace root", () => {
    expect(computeFileDir(undefined, "note.md")).toBeNull();
    expect(computeFileDir(null, "note.md")).toBeNull();
  });

  it("falls back to the root when the file path is unknown", () => {
    expect(computeFileDir("/ws", undefined)).toBe("/ws");
  });

  it("is the directory containing the active file", () => {
    expect(computeFileDir("/ws", "note.md")).toBe("/ws");
    expect(computeFileDir("/ws", "sub/note.md")).toBe("/ws/sub");
  });
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
