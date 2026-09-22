// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { ClipboardEntry } from "../captureApi";
import { entryMarkdown } from "./entryMarkdown";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function entry(extra: Partial<ClipboardEntry>): ClipboardEntry {
  return { id: "e", kind: "text", text: "", html: null, imageDataUrl: null, ...extra };
}

const noImages = vi.fn(async () => {});

describe("a clipboard entry as Markdown", () => {
  it("keeps plain text as it was", async () => {
    expect(await entryMarkdown(entry({ text: "Just words" }), noImages)).toBe("Just words");
  });

  it("converts formatted text as a paste would", async () => {
    const markdown = await entryMarkdown(entry({ text: "Title list", html: "<h2>Title</h2><ul><li>one</li><li>two</li></ul>" }), noImages);
    expect(markdown).toContain("## Title");
    expect(markdown).toMatch(/-\s+one/);
  });

  it("takes Compose's own copies as the Markdown they already are", async () => {
    const own = entry({ text: "**bold**", html: '<div data-compose-markdown=""><strong>bold</strong></div>' });
    expect(await entryMarkdown(own, noImages)).toBe("**bold**");
  });

  it("writes a link as a link", async () => {
    expect(await entryMarkdown(entry({ kind: "link", text: " https://example.com/a " }), noImages)).toBe("<https://example.com/a>");
  });

  it("lists copied files as links to them", async () => {
    const files = entry({ kind: "files", text: "/Users/me/My Report (final).pdf\n/Users/me/b.png" });
    expect(await entryMarkdown(files, noImages)).toBe(
      "- [My Report (final).pdf](file:///Users/me/My%20Report%20%28final%29.pdf)\n- [b.png](file:///Users/me/b.png)",
    );
  });

  it("saves an image with the note and links it", async () => {
    const saveImage = vi.fn(async () => {});
    const markdown = await entryMarkdown(entry({ kind: "image", imageDataUrl: PNG }), saveImage);
    expect(saveImage).toHaveBeenCalledTimes(1);
    const [path, bytes] = saveImage.mock.calls[0] as unknown as [string, Uint8Array];
    expect(path).toMatch(/^images\/.+\.png$/);
    expect(Array.from(bytes.slice(1, 4))).toEqual([80, 78, 71]);
    expect(markdown).toBe(`![copied-image](${path})`);
  });
});
