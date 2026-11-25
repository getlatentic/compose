import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeLargeNote, parseSize, section } from "./make-large-note.mjs";

let folder;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "large-note-"));
});
afterEach(() => rm(folder, { recursive: true, force: true }));

describe("a size", () => {
  it.each([
    ["3MB", 3 * 1024 ** 2],
    ["200 mb", 200 * 1024 ** 2],
    ["10GB", 10 * 1024 ** 3],
    ["1.5GB", 1.5 * 1024 ** 3],
    ["512KB", 512 * 1024],
  ])("%s is %i bytes", (text, bytes) => {
    expect(parseSize(text)).toBe(bytes);
  });

  it.each(["", "3", "MB", "3 megabytes", "-1MB", "3TB"])("%j is refused", (text) => {
    expect(() => parseSize(text)).toThrow(/KB, MB or GB/);
  });
});

describe("a large note", () => {
  it("is whole sections, in order, at least the size asked for", async () => {
    const path = join(folder, "note.md");
    const { bytes, sections } = await makeLargeNote({ size: 300_000, path });
    const text = await readFile(path, "utf8");
    expect(bytes).toBe((await stat(path)).size);
    expect(bytes).toBeGreaterThanOrEqual(300_000);
    expect(text.startsWith("# Large note\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(true);
    expect([...text.matchAll(/^## Section (\d+)$/gm)].map((match) => Number(match[1]))).toEqual(Array.from({ length: sections }, (_, n) => n));
  });

  it("shows a list, a table, a code block and math in every section", () => {
    const text = section(7);
    for (const part of ["- first point of 7", "| 7 | x |", "```ts", "$x_{7} = \\frac{7}{2}$"]) expect(text).toContain(part);
    expect(section(7)).toBe(text);
  });

  it("does not replace a file unless told to", async () => {
    const path = join(folder, "note.md");
    await writeFile(path, "mine");
    await expect(makeLargeNote({ size: 1000, path })).rejects.toThrow(/--force/);
    expect(await readFile(path, "utf8")).toBe("mine");
    await makeLargeNote({ size: 1000, path, force: true });
    expect((await readFile(path, "utf8")).startsWith("# Large note")).toBe(true);
  });

  it("writes nothing when the disk cannot hold it", async () => {
    const path = join(folder, "never.md");
    await expect(makeLargeNote({ size: 1024 ** 5, path })).rejects.toThrow(/not enough free disk/);
    await expect(stat(path)).rejects.toThrow();
  });
});
