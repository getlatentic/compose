import { describe, expect, it } from "vitest";

import { formatFileSize } from "./formatFileSize";

describe("a file's size, as a person reads it", () => {
  it.each([
    [6 * 1024 * 1024, "6.0 MB"],
    [640 * 1024, "640 KB"],
    [1.25 * 1024 ** 3, "1.3 GB"],
    [10 * 1024 ** 3, "10.0 GB"],
    [300 * 1024 ** 3, "300 GB"],
  ])("%i bytes is %s", (bytes, shown) => {
    expect(formatFileSize(bytes)).toBe(shown);
  });
});
