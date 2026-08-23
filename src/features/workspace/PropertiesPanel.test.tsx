import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PropertiesPanel, withoutField } from "./PropertiesPanel";

describe("removing a property", () => {
  it("leaves no frontmatter behind when the last one goes", () => {
    // The caller re-serializes whatever it receives. An empty object writes an
    // empty `---` block back into the file; null removes the block.
    expect(withoutField({ tags: "a" }, "tags")).toBeNull();
  });

  it("keeps the others", () => {
    expect(withoutField({ tags: "a", title: "b" }, "tags")).toEqual({ title: "b" });
  });

  it("does not mutate what it was given", () => {
    // The panel is memoized on `frontmatter` identity, so editing the caller's
    // object in place would leave the UI showing a field that is already gone.
    const original = { tags: "a", title: "b" };
    withoutField(original, "tags");
    expect(original).toEqual({ tags: "a", title: "b" });
  });

  it("is a no-op for a key that is not there", () => {
    expect(withoutField({ title: "b" }, "missing")).toEqual({ title: "b" });
  });
});

describe("what the panel shows", () => {
  it("invites the first field when a file has no frontmatter", () => {
    const html = renderToStaticMarkup(
      <PropertiesPanel frontmatter={null} onCommitFrontmatter={() => {}} />,
    );
    expect(html).toContain("No frontmatter on this file");
    expect(html).toContain("Empty");
  });

  it("counts the fields, and says it in singular and plural", () => {
    const one = renderToStaticMarkup(
      <PropertiesPanel frontmatter={{ title: "Notes" }} onCommitFrontmatter={() => {}} />,
    );
    expect(one).toContain("1 field");
    expect(one).not.toContain("1 fields");

    const two = renderToStaticMarkup(
      <PropertiesPanel
        frontmatter={{ title: "Notes", tags: "a" }}
        onCommitFrontmatter={() => {}}
      />,
    );
    expect(two).toContain("2 fields");
  });

  it("shows every field it was given, not just the first", () => {
    const html = renderToStaticMarkup(
      <PropertiesPanel
        frontmatter={{ title: "Notes", status: "draft", tags: "research" }}
        onCommitFrontmatter={() => {}}
      />,
    );
    for (const key of ["title", "status", "tags"]) {
      expect(html).toContain(key);
    }
    expect(html).not.toContain("No frontmatter on this file");
  });

  it("cannot add a field with no name", () => {
    // The button is the only way in; enabled with an empty draft it commits a
    // blank key, which serializes to a `:` line the parser then drops.
    const html = renderToStaticMarkup(
      <PropertiesPanel frontmatter={null} onCommitFrontmatter={() => {}} />,
    );
    expect(html).toMatch(/aria-label="Add property"[^>]*disabled|disabled[^>]*aria-label="Add property"/);
  });
});
