import { describe, expect, it } from "vitest";
import { percentile, round2, summarize } from "./statistics";

describe("percentile (R-7 linear interpolation)", () => {
  it("returns the only value for a single sample", () => {
    expect(percentile([42], 0.95)).toBe(42);
  });

  it("returns 0 for an empty set", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("computes the median by interpolating the middle", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3], 0.5)).toBe(2);
  });

  it("interpolates p95 between ranks rather than snapping to max", () => {
    // 0..100 step 10. Rank = 0.95 * 10 = 9.5 → between index 9 (90) and
    // 10 (100) → 95. A nearest-rank method would over-report 100.
    const values = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 0.95)).toBe(95);
  });
});

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(676.3049)).toBe(676.3);
    expect(round2(0.005)).toBe(0.01);
    expect(round2(9.354)).toBe(9.35);
  });
});

describe("summarize", () => {
  it("returns zeros for an empty sample set", () => {
    expect(summarize([])).toEqual({ samples: 0, medianMs: 0, p95Ms: 0, meanMs: 0 });
  });

  it("does not mutate the input array", () => {
    const input = [3, 1, 2];
    summarize(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("reports samples, median, p95, and mean rounded to two decimals", () => {
    const summary = summarize([4, 1, 2, 3, 5]);
    expect(summary.samples).toBe(5);
    expect(summary.medianMs).toBe(3);
    expect(summary.meanMs).toBe(3);
    // Rank = 0.95 * 4 = 3.8 → between 4 and 5 → 4.8.
    expect(summary.p95Ms).toBe(4.8);
  });

  it("keeps p95 >= median for a skewed set", () => {
    const summary = summarize([1, 1, 1, 1, 100]);
    expect(summary.p95Ms).toBeGreaterThanOrEqual(summary.medianMs);
  });
});
