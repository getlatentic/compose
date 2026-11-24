import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const STYLES = new URL("./", import.meta.url);

function read(name: string): string {
  return readFileSync(new URL(name, STYLES), "utf8");
}

/** Carbon's sizes are not colours: no palette sets them. */
const NOT_A_COLOUR = /^--cds-(spacing|size|layout)-/;

describe("Carbon's colour tokens", () => {
  it("are all pointed at the palette, so no stylesheet paints Carbon's own light grey in a dark theme", () => {
    const stylesheets = readdirSync(STYLES).filter((name) => name.endsWith(".scss"));
    const used = new Set(stylesheets.flatMap((name) => [...read(name).matchAll(/var\((--cds-[a-z0-9-]+)/g)].map((match) => match[1])));
    const aliases = read("_appearance-mixins.scss");
    const unmapped = [...used].filter((token) => !NOT_A_COLOUR.test(token) && !aliases.includes(`${token}:`));
    expect(used.size).toBeGreaterThan(20);
    expect(used).toContain("--cds-text-helper");
    expect(unmapped).toEqual([]);
  });

  it("cover the ones Carbon's own toasts paint with, which no stylesheet here reads", () => {
    const aliases = read("_appearance-mixins.scss");
    for (const kind of ["success", "info", "warning", "error"]) {
      expect(aliases).toContain(`--cds-notification-background-${kind}:`);
    }
  });
});
