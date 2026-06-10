/**
 * Coordinate-conversion module for document text. Single owner of
 * byte↔code-unit translation per spec §6.2 ("Coordinate discipline").
 *
 * The source of truth for persisted positions is the UTF-8 `ByteOffset`.
 * JavaScript strings are indexed by UTF-16 code units. Converting between
 * them is unavoidable at the boundary between the engine (which speaks
 * bytes) and DOM/Canvas APIs (which speak code units).
 *
 * Two surfaces are exposed:
 *
 *   1. Free helpers — `byteLength`, `byteOffsetToCodeUnitIndex`,
 *      `codeUnitIndexToByteOffset`, `sliceByByteRange`. Each is a single
 *      forward walk over the input with inline UTF-8 byte-length math.
 *      Suitable when the caller does one or two conversions on a string
 *      it does not plan to re-query.
 *
 *   2. `PositionMapper` — builds a sparse chunk index (one entry per
 *      `CHUNK_SIZE` code units) over the text in O(n), then services
 *      every later lookup in O(log n) chunks + O(chunk) intra-chunk walk
 *      (effectively constant). Suitable when a caller does many lookups
 *      on the same snapshot (per-frame renderer, comment-thread builder,
 *      workspace transactions, bulk import).
 */

const CHUNK_SIZE = 1024;

export interface SourceRange {
  end: number;
  start: number;
}

function utf8ByteLengthForCodePoint(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

export function byteLength(text: string): number {
  let total = 0;
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)!;
    total += utf8ByteLengthForCodePoint(codePoint);
    index += codePoint >= 0x10000 ? 2 : 1;
  }
  return total;
}

export function codeUnitIndexToByteOffset(text: string, codeUnitIndex: number): number {
  if (codeUnitIndex <= 0) return 0;
  const limit = Math.min(codeUnitIndex, text.length);
  let total = 0;
  for (let index = 0; index < limit; ) {
    const codePoint = text.codePointAt(index)!;
    total += utf8ByteLengthForCodePoint(codePoint);
    index += codePoint >= 0x10000 ? 2 : 1;
  }
  return total;
}

export function byteOffsetToCodeUnitIndex(text: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0;
  let currentByteOffset = 0;
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)!;
    const nextByteOffset = currentByteOffset + utf8ByteLengthForCodePoint(codePoint);
    if (nextByteOffset > byteOffset) return index;
    currentByteOffset = nextByteOffset;
    index += codePoint >= 0x10000 ? 2 : 1;
  }
  return text.length;
}

export function sliceByByteRange(text: string, range: SourceRange): string {
  const startByte = Math.max(0, range.start);
  const endByte = Math.max(startByte, range.end);

  let startCodeUnit = -1;
  let endCodeUnit = -1;
  let currentByteOffset = 0;
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)!;
    const nextByteOffset = currentByteOffset + utf8ByteLengthForCodePoint(codePoint);
    if (startCodeUnit === -1 && nextByteOffset > startByte) {
      startCodeUnit = index;
    }
    if (nextByteOffset > endByte) {
      endCodeUnit = index;
      break;
    }
    currentByteOffset = nextByteOffset;
    index += codePoint >= 0x10000 ? 2 : 1;
  }
  if (startCodeUnit === -1) startCodeUnit = text.length;
  if (endCodeUnit === -1) endCodeUnit = text.length;
  return text.slice(startCodeUnit, endCodeUnit);
}

/**
 * Cached coordinate mapper for a single document snapshot.
 *
 * Construction is O(n) — one walk over the text builds a chunk index of
 * (code-unit, byte) pairs spaced every `CHUNK_SIZE` code units. After
 * that every `byteToCodeUnit` / `codeUnitToByte` / `sliceByByteRange`
 * call is a binary search on the chunk array followed by a bounded walk
 * within the matching chunk (≤ `CHUNK_SIZE` code points).
 *
 * The mapper holds the text by reference; it is only valid for that
 * exact string. Build a new mapper on every text mutation. For
 * caller-side caching keyed by an immutable owner (a workspace file
 * buffer, a presentation plan), pair the mapper with the owner in a
 * `WeakMap` — see callers in workspaceModel/canvas renderer.
 */
export class PositionMapper {
  readonly text: string;
  readonly byteLength: number;
  /** Code-unit index at the start of each chunk. Sentinel: last entry === text.length. */
  private readonly chunkCodeUnits: Uint32Array;
  /** Byte offset corresponding to chunkCodeUnits[k]. Sentinel: last entry === byteLength. */
  private readonly chunkBytes: Uint32Array;

  constructor(text: string) {
    this.text = text;

    const codeUnits: number[] = [0];
    const bytes: number[] = [0];

    let codeUnit = 0;
    let byte = 0;
    let nextBoundary = CHUNK_SIZE;

    while (codeUnit < text.length) {
      const codePoint = text.codePointAt(codeUnit)!;
      byte += utf8ByteLengthForCodePoint(codePoint);
      codeUnit += codePoint >= 0x10000 ? 2 : 1;
      while (codeUnit >= nextBoundary) {
        codeUnits.push(codeUnit);
        bytes.push(byte);
        nextBoundary += CHUNK_SIZE;
      }
    }

    // Sentinel keeps binary search well-defined for "past the end" queries
    // and lets us short-circuit lookups at the document tail.
    codeUnits.push(text.length);
    bytes.push(byte);

    this.chunkCodeUnits = new Uint32Array(codeUnits);
    this.chunkBytes = new Uint32Array(bytes);
    this.byteLength = byte;
  }

  codeUnitToByte(codeUnitIndex: number): number {
    if (codeUnitIndex <= 0) return 0;
    if (codeUnitIndex >= this.text.length) return this.byteLength;

    const chunkIndex = floorSearch(this.chunkCodeUnits, codeUnitIndex);
    let codeUnit = this.chunkCodeUnits[chunkIndex];
    let byte = this.chunkBytes[chunkIndex];
    while (codeUnit < codeUnitIndex) {
      const codePoint = this.text.codePointAt(codeUnit)!;
      byte += utf8ByteLengthForCodePoint(codePoint);
      codeUnit += codePoint >= 0x10000 ? 2 : 1;
    }
    return byte;
  }

  byteToCodeUnit(byteOffset: number): number {
    if (byteOffset <= 0) return 0;
    if (byteOffset >= this.byteLength) return this.text.length;

    const chunkIndex = floorSearch(this.chunkBytes, byteOffset);
    let codeUnit = this.chunkCodeUnits[chunkIndex];
    let byte = this.chunkBytes[chunkIndex];
    while (codeUnit < this.text.length) {
      const codePoint = this.text.codePointAt(codeUnit)!;
      const nextByte = byte + utf8ByteLengthForCodePoint(codePoint);
      if (nextByte > byteOffset) return codeUnit;
      byte = nextByte;
      codeUnit += codePoint >= 0x10000 ? 2 : 1;
    }
    return this.text.length;
  }

  sliceByByteRange(range: SourceRange): string {
    const startByte = Math.max(0, range.start);
    const endByte = Math.max(startByte, range.end);
    const startCodeUnit = this.byteToCodeUnit(startByte);
    const endCodeUnit = this.byteToCodeUnit(endByte);
    return this.text.slice(startCodeUnit, endCodeUnit);
  }
}

/**
 * Largest index `k` such that `array[k] <= value`. Both arrays in
 * `PositionMapper` are strictly non-decreasing (a chunk always advances
 * at least one code unit / one byte), and the [0] entry is always 0, so
 * a value ≥ 0 is guaranteed to find a chunk.
 */
function floorSearch(array: Uint32Array, value: number): number {
  let lo = 0;
  let hi = array.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (array[mid] <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
