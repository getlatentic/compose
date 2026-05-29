import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildIndex,
  initSync,
  searchIndex,
} from "../../wasm/workspace_index_pkg/workspace_index_wasm.js";

/**
 * Exercises the workspace-index WASM through its JSON boundary — the same
 * Rust core the desktop runs natively, here proving the wire contract the
 * browser depends on (build -> snapshot JSON; search -> hits JSON with
 * UTF-8 byte ranges). Loads the compiled artifact via `initSync` in Node,
 * the way the benchmark loaded the old engine.
 */
beforeAll(() => {
  const wasmPath = fileURLToPath(
    new URL("../../wasm/workspace_index_pkg/workspace_index_wasm_bg.wasm", import.meta.url),
  );
  initSync({ module: readFileSync(wasmPath) });
});

describe("workspace-index WASM (same core as desktop)", () => {
  it("builds a snapshot with documents, resolved links, and tags", () => {
    const docs = [
      {
        docId: "w:notes/source.md",
        path: "notes/source.md",
        content: "---\ntags: [alpha]\n---\n# Source\n\nSee [[Target note|target]] and #beta.",
      },
      { docId: "w:research/target-note.md", path: "research/target-note.md", content: "# Target note" },
    ];

    const snapshot = JSON.parse(buildIndex("w", JSON.stringify(docs), 1_700_000_000_000));

    expect(snapshot.indexedDocumentCount).toBe(2);
    expect(snapshot.documents.map((d: { path: string }) => d.path).sort()).toEqual([
      "notes/source.md",
      "research/target-note.md",
    ]);
    // content is skip_serializing — the UI never receives document bodies.
    expect(snapshot.documents[0]).not.toHaveProperty("content");
    // The wikilink resolves to the existing target document.
    expect(snapshot.backlinks).toHaveLength(1);
    expect(snapshot.backlinks[0].targetPath).toBe("research/target-note.md");
    // Frontmatter `alpha` + inline `#beta`.
    expect(snapshot.tags.map((t: { tag: string }) => t.tag).sort()).toEqual(["alpha", "beta"]);
  });

  it("searches a built index and returns UTF-8 byte ranges", () => {
    const docs = [
      { docId: "w2:notes/cafe.md", path: "notes/cafe.md", content: "# Café\n\nRésumé notes for Café Bob." },
    ];
    buildIndex("w2", JSON.stringify(docs), 1_700_000_000_000);

    const hits = JSON.parse(searchIndex("w2", "Résumé", 10));

    expect(hits).toHaveLength(1);
    expect(hits[0].ranges).toEqual([{ start: 9, end: 17 }]);
    expect(hits[0].snippet).toContain("Résumé notes");
  });

  it("returns no hits for a workspace that was never built", () => {
    expect(JSON.parse(searchIndex("never-built", "anything", 5))).toEqual([]);
  });
});
