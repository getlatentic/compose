import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  documentKind,
  isMarkdownPath,
  isPlainTextPath,
  MARKDOWN_EXTENSIONS,
  PLAIN_TEXT_EXTENSIONS,
  withoutDocumentExtension,
} from "./documentKind";

describe("what kind of document a file is", () => {
  it("knows a note under every Markdown extension, in any case", () => {
    for (const path of ["a.md", "a.markdown", "dir/a.mdown", "A.MKD", "notes/v1.2.md"]) {
      expect(isMarkdownPath(path), path).toBe(true);
    }
  });

  it("knows a text file", () => {
    expect(isPlainTextPath("/Users/me/todo.TXT")).toBe(true);
    expect(isMarkdownPath("/Users/me/todo.txt")).toBe(false);
  });

  it("is neither for anything else", () => {
    for (const path of ["photo.png", "README", ".md", "dir/.txt", "a.md.bak", "dir.md/file"]) {
      expect(documentKind(path), path).toBeNull();
    }
  });

  it("drops only a document's own extension", () => {
    expect(withoutDocumentExtension("notes/plan.markdown")).toBe("notes/plan");
    expect(withoutDocumentExtension("todo.txt")).toBe("todo");
    expect(withoutDocumentExtension("notes/v1.2.md")).toBe("notes/v1.2");
    expect(withoutDocumentExtension("photo.png")).toBe("photo.png");
    expect(withoutDocumentExtension(".md")).toBe(".md");
  });

  it("opens exactly the file types Compose declares to macOS", () => {
    const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
      bundle: { fileAssociations: Array<{ ext: string[] }> };
    };
    const declared = config.bundle.fileAssociations.flatMap((association) => association.ext).sort();
    expect([...MARKDOWN_EXTENSIONS, ...PLAIN_TEXT_EXTENSIONS].sort()).toEqual(declared);
  });
});
