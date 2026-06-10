import { describe, expect, it } from "vitest";

import { formatCoins, formatCompact } from "./numbers";

describe("formatCompact", () => {
  it("leaves small counts intact and compacts large ones", () => {
    expect(formatCompact(678)).toBe("678");
    expect(formatCompact(25_678)).toBe("25.7K");
    expect(formatCompact(25_678_891)).toBe("25.7M");
    expect(formatCompact(0)).toBe("0");
  });
});

describe("formatCoins", () => {
  it("trims to 2 decimals and drops trailing zeros", () => {
    expect(formatCoins(0.052757)).toBe("0.05");
    expect(formatCoins(0.5)).toBe("0.5");
    expect(formatCoins(3)).toBe("3");
    expect(formatCoins(27.57)).toBe("27.57");
  });
});
