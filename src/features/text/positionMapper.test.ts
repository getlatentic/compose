import { describe, expect, it } from "vitest";
import {
  byteLength,
  byteOffsetToCodeUnitIndex,
  codeUnitIndexToByteOffset,
  PositionMapper,
  sliceByByteRange,
} from "./positionMapper";

describe("free helpers — byte length", () => {
  it("counts ASCII as one byte per code unit", () => {
    expect(byteLength("")).toBe(0);
    expect(byteLength("hello")).toBe(5);
  });

  it("counts 2-byte UTF-8 characters", () => {
    expect(byteLength("é")).toBe(2);
    expect(byteLength("café")).toBe(5);
  });

  it("counts 3-byte UTF-8 characters", () => {
    expect(byteLength("中")).toBe(3);
    expect(byteLength("中文")).toBe(6);
  });

  it("counts 4-byte UTF-8 characters (astral / surrogate pairs)", () => {
    expect(byteLength("😀")).toBe(4);
    expect(byteLength("A😀B")).toBe(6);
  });

  it("agrees with TextEncoder on well-formed text", () => {
    const samples = [
      "",
      "abc",
      "café 中文 😀",
      "mixed\nline\nbreaks",
      "RTL: שלום עולם",
      "combining: é", // e + combining acute
    ];
    const encoder = new TextEncoder();
    for (const sample of samples) {
      expect(byteLength(sample)).toBe(encoder.encode(sample).length);
    }
  });
});

describe("free helpers — code-unit ↔ byte", () => {
  it("returns 0 for boundary inputs", () => {
    expect(codeUnitIndexToByteOffset("abc", 0)).toBe(0);
    expect(byteOffsetToCodeUnitIndex("abc", 0)).toBe(0);
    expect(byteOffsetToCodeUnitIndex("", 5)).toBe(0);
    expect(codeUnitIndexToByteOffset("", 5)).toBe(0);
  });

  it("round-trips on well-formed boundaries", () => {
    const text = "A 😀 café 中文 שלום";
    for (let codeUnit = 0; codeUnit <= text.length; codeUnit += 1) {
      // Skip mid-surrogate positions — those have undefined semantics
      // and are never produced by valid string operations.
      const codeBefore = codeUnit > 0 ? text.charCodeAt(codeUnit - 1) : 0;
      const codeAt = codeUnit < text.length ? text.charCodeAt(codeUnit) : 0;
      const isMidSurrogate =
        codeBefore >= 0xd800 && codeBefore <= 0xdbff && codeAt >= 0xdc00 && codeAt <= 0xdfff;
      if (isMidSurrogate) continue;

      const byte = codeUnitIndexToByteOffset(text, codeUnit);
      expect(byteOffsetToCodeUnitIndex(text, byte)).toBe(codeUnit);
    }
  });

  it("snaps byte offsets that land inside a multi-byte char back to the char start", () => {
    const text = "à"; // U+00E0, two UTF-8 bytes
    expect(byteOffsetToCodeUnitIndex(text, 0)).toBe(0);
    expect(byteOffsetToCodeUnitIndex(text, 1)).toBe(0);
    expect(byteOffsetToCodeUnitIndex(text, 2)).toBe(1);
  });

  it("clamps past-end inputs to length", () => {
    expect(codeUnitIndexToByteOffset("abc", 100)).toBe(3);
    expect(byteOffsetToCodeUnitIndex("abc", 100)).toBe(3);
  });
});

describe("free helpers — sliceByByteRange", () => {
  it("slices ASCII by byte boundary", () => {
    expect(sliceByByteRange("abcdef", { start: 1, end: 4 })).toBe("bcd");
  });

  it("preserves multi-byte characters when byte range covers them whole", () => {
    const text = "café 中文";
    // bytes: c(1) a(1) f(1) é(2) ' '(1) 中(3) 文(3) = 12
    expect(sliceByByteRange(text, { start: 0, end: 5 })).toBe("café");
    expect(sliceByByteRange(text, { start: 6, end: 9 })).toBe("中");
    expect(sliceByByteRange(text, { start: 6, end: 12 })).toBe("中文");
  });

  it("returns empty string for empty or inverted ranges", () => {
    expect(sliceByByteRange("abc", { start: 1, end: 1 })).toBe("");
    expect(sliceByByteRange("abc", { start: 2, end: 1 })).toBe("");
  });

  it("clamps to document bounds", () => {
    expect(sliceByByteRange("abc", { start: -5, end: 100 })).toBe("abc");
  });
});

describe("PositionMapper — single-chunk", () => {
  it("reports byte length without walking on every query", () => {
    const mapper = new PositionMapper("café 中文 😀");
    expect(mapper.byteLength).toBe(byteLength("café 中文 😀"));
  });

  it("matches free-helper output across a small sample", () => {
    const text = "A 😀 café 中文 שלום";
    const mapper = new PositionMapper(text);
    for (let codeUnit = 0; codeUnit <= text.length; codeUnit += 1) {
      const codeBefore = codeUnit > 0 ? text.charCodeAt(codeUnit - 1) : 0;
      const codeAt = codeUnit < text.length ? text.charCodeAt(codeUnit) : 0;
      const isMidSurrogate =
        codeBefore >= 0xd800 && codeBefore <= 0xdbff && codeAt >= 0xdc00 && codeAt <= 0xdfff;
      if (isMidSurrogate) continue;
      expect(mapper.codeUnitToByte(codeUnit)).toBe(codeUnitIndexToByteOffset(text, codeUnit));
    }
    for (let byte = 0; byte <= mapper.byteLength; byte += 1) {
      expect(mapper.byteToCodeUnit(byte)).toBe(byteOffsetToCodeUnitIndex(text, byte));
    }
  });

  it("slices by byte range identically to the free helper", () => {
    const text = "café 中文 😀";
    const mapper = new PositionMapper(text);
    const cases: { start: number; end: number }[] = [
      { start: 0, end: mapper.byteLength },
      { start: 0, end: 5 }, // "café"
      { start: 6, end: 12 }, // "中文"
      { start: 13, end: 17 }, // "😀"
      { start: 5, end: 5 }, // empty
      { start: -1, end: 5 }, // negative clamped
    ];
    for (const range of cases) {
      expect(mapper.sliceByByteRange(range)).toBe(sliceByByteRange(text, range));
    }
  });
});

describe("PositionMapper — cross-chunk", () => {
  // Force multiple chunks: CHUNK_SIZE in positionMapper.ts is 1024.
  const longText = "A 😀 中文 café\n".repeat(400); // ~5 KB, ~5+ chunks
  const mapper = new PositionMapper(longText);

  it("agrees with free helpers at random sample positions across chunks", () => {
    const random = mulberry32(0xdeadbeef);
    for (let trial = 0; trial < 200; trial += 1) {
      const codeUnit = Math.floor(random() * (longText.length + 1));
      // Skip mid-surrogate positions
      const codeBefore = codeUnit > 0 ? longText.charCodeAt(codeUnit - 1) : 0;
      const codeAt = codeUnit < longText.length ? longText.charCodeAt(codeUnit) : 0;
      const isMidSurrogate =
        codeBefore >= 0xd800 && codeBefore <= 0xdbff && codeAt >= 0xdc00 && codeAt <= 0xdfff;
      if (isMidSurrogate) continue;
      const expectedByte = codeUnitIndexToByteOffset(longText, codeUnit);
      expect(mapper.codeUnitToByte(codeUnit)).toBe(expectedByte);
      expect(mapper.byteToCodeUnit(expectedByte)).toBe(codeUnit);
    }
  });

  it("services 10 000 lookups on a 500 KB document with correct results", () => {
    // The hard wall-clock gate for this hot loop lives in the lag
    // benchmark (`positionMapperLookup10k` in
    // src/features/benchmark/textOperations.ts). A wall-clock assertion
    // here only measured the runner's spare CPU — it flaked at ~156ms
    // against a 150ms budget under contention. This test keeps the
    // correctness half: 10k lookups spread across a large ASCII document
    // must each resolve to the right code unit (byte == code unit for
    // ASCII), which a quadratic-by-allocation regression cannot fake.
    const paragraph = "Paragraph with **bold**, *italic*, `code`, [link](https://example.com).\n";
    const text = paragraph.repeat(Math.ceil((500 * 1024) / paragraph.length));
    expect(text.length).toBeGreaterThanOrEqual(500 * 1024);
    expect(byteLength(text)).toBe(text.length); // guards the ASCII assumption

    const built = new PositionMapper(text);
    const random = mulberry32(0xc0ffee);
    let mismatches = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const byte = Math.floor(random() * built.byteLength);
      if (built.byteToCodeUnit(byte) !== byte) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });
});

/**
 * Tiny seeded PRNG so cross-chunk tests are deterministic even when run
 * in parallel. Source: standard 32-bit Mulberry. We only need it to
 * spread sample positions evenly across the document; cryptographic
 * quality is irrelevant.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
