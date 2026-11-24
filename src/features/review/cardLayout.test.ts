import { describe, expect, it } from "vitest";

import { placeCards } from "./cardLayout";

const slots = [
  { anchor: 100, height: 30 },
  { anchor: 110, height: 30 },
  { anchor: 120, height: 30 },
  { anchor: 400, height: 30 },
];

describe("placeCards", () => {
  it("puts each card level with its line when nothing crowds it", () => {
    expect(placeCards([{ anchor: 10, height: 20 }, { anchor: 100, height: 20 }], -1, 8)).toEqual([10, 100]);
  });

  it("with no active card, pushes crowded cards down from the first", () => {
    expect(placeCards(slots, -1, 8)).toEqual([100, 138, 176, 400]);
  });

  it("lines the active card up with its words and moves its neighbours around it", () => {
    const tops = placeCards(slots, 2, 8);
    expect(tops[2]).toBe(120);
    expect(tops).toEqual([44, 82, 120, 400]);
  });

  it("never overlaps two cards", () => {
    for (const active of [-1, 0, 1, 2, 3]) {
      const tops = placeCards(slots, active, 8);
      for (let index = 1; index < tops.length; index += 1) {
        expect(tops[index]).toBeGreaterThanOrEqual(tops[index - 1] + slots[index - 1].height + 8);
      }
    }
  });
});
