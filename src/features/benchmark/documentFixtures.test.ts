import { describe, expect, it } from "vitest";
import { byteLength } from "../text/positionMapper";
import {
  buildDocument,
  DOCUMENT_SIZE_LABELS,
  lineByteRanges,
  type DocumentSizeLabel,
} from "./documentFixtures";

describe("buildDocument", () => {
  it("is deterministic — same bytes every build", () => {
    expect(buildDocument("large").text).toBe(buildDocument("large").text);
  });

  it("produces ASCII-only content so byte length == code-unit length", () => {
    for (const label of DOCUMENT_SIZE_LABELS) {
      const doc = buildDocument(label);
      expect(byteLength(doc.text)).toBe(doc.text.length);
      expect(doc.byteSize).toBe(doc.text.length);
    }
  });

  it("scales monotonically across size labels", () => {
    const sizes = DOCUMENT_SIZE_LABELS.map((label) => buildDocument(label).byteSize);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
    }
  });

  it("hits the rough byte targets for large and xlarge", () => {
    expect(buildDocument("large").byteSize).toBeGreaterThanOrEqual(300 * 1024);
    expect(buildDocument("xlarge").byteSize).toBeGreaterThanOrEqual(500 * 1024);
  });

  it("reports a line count consistent with the newline count", () => {
    const doc = buildDocument("small");
    const newlines = doc.text.split("\n").length;
    expect(doc.lineCount).toBe(newlines);
  });

  it("labels each document with its size", () => {
    for (const label of DOCUMENT_SIZE_LABELS) {
      expect(buildDocument(label as DocumentSizeLabel).label).toBe(label);
    }
  });
});

describe("lineByteRanges", () => {
  it("returns half-open ranges that map back to each line's text", () => {
    const text = "alpha\nbeta\ngamma";
    const ranges = lineByteRanges(text, 0, 3);
    expect(ranges).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 10 },
      { start: 11, end: 16 },
    ]);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe("alpha");
    expect(text.slice(ranges[2].start, ranges[2].end)).toBe("gamma");
  });

  it("starts at firstLine and clamps to available lines", () => {
    const text = "one\ntwo\nthree\nfour";
    const ranges = lineByteRanges(text, 2, 10);
    expect(ranges).toHaveLength(2);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe("three");
    expect(text.slice(ranges[1].start, ranges[1].end)).toBe("four");
  });

  it("returns at most `count` ranges", () => {
    const doc = buildDocument("large");
    expect(lineByteRanges(doc.text, 100, 50)).toHaveLength(50);
  });
});
