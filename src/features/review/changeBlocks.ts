import { diffLines } from "../diff/lineDiff";

/**
 * One contiguous change between two texts: the lines it takes out of the
 * first and the lines it puts in from the second. Either side may be empty
 * (a pure insertion or deletion), never both.
 */
export interface ChangeBlock {
  readonly removed: readonly string[];
  readonly added: readonly string[];
  /** 0-based line in the first text where the block starts; for an insertion,
   *  the line it goes in front of. */
  readonly beforeLine: number;
  /** The same, in the second text. */
  readonly afterLine: number;
}

export function changeBlocks(before: string, after: string): ChangeBlock[] {
  const blocks: ChangeBlock[] = [];
  let current: { removed: string[]; added: string[]; beforeLine: number; afterLine: number } | null = null;
  let beforeLine = 0;
  let afterLine = 0;
  for (const line of diffLines(before, after).lines) {
    if (line.kind === "context") {
      if (current) {
        blocks.push(current);
        current = null;
      }
      beforeLine += 1;
      afterLine += 1;
      continue;
    }
    current ??= { removed: [], added: [], beforeLine, afterLine };
    if (line.kind === "remove") {
      current.removed.push(line.text);
      beforeLine += 1;
    } else {
      current.added.push(line.text);
      afterLine += 1;
    }
  }
  if (current) {
    blocks.push(current);
  }
  return blocks;
}

/** What a block changes, as a string: two blocks with the same content share it. */
export function blockContent(block: ChangeBlock): string {
  return `${block.removed.join("\n")}\u0000${block.added.join("\n")}`;
}

/**
 * A key per block that survives the text moving around it: its content, plus
 * which occurrence of that content it is. The same edit made twice in one
 * file gets two keys.
 */
export function blockKeys(blocks: readonly ChangeBlock[]): string[] {
  const seen = new Map<string, number>();
  return blocks.map((block) => {
    const content = blockContent(block);
    const occurrence = seen.get(content) ?? 0;
    seen.set(content, occurrence + 1);
    return `${occurrence}:${content}`;
  });
}
