/** A card to place: the top of the line it belongs to, and its own height. */
export interface CardSlot {
  readonly anchor: number;
  readonly height: number;
}

/**
 * Tops for cards sorted by anchor, none overlapping. The active card sits
 * level with its own line; the cards after it move down only as far as they
 * must, and the cards before it move up. With no active card, the first one
 * leads, so a card only ever sits at or below its line.
 */
export function placeCards(slots: readonly CardSlot[], active: number, gap: number): number[] {
  const tops = slots.map((slot) => slot.anchor);
  const lead = active >= 0 && active < slots.length ? active : 0;
  for (let index = lead + 1; index < slots.length; index += 1) {
    tops[index] = Math.max(slots[index].anchor, tops[index - 1] + slots[index - 1].height + gap);
  }
  for (let index = lead - 1; index >= 0; index -= 1) {
    tops[index] = Math.min(slots[index].anchor, tops[index + 1] - gap - slots[index].height);
  }
  return tops;
}
