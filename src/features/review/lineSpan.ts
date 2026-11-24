/** Offsets where each line of `text` starts (one past the end when it ends in a newline). */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/**
 * The note range of `count` lines starting at `line`, and the text that
 * swaps them for `other`. Whole lines, with the newline handled so that
 * deleting or inserting lines leaves no blank line behind.
 */
export function lineSpan(
  text: string,
  starts: readonly number[],
  line: number,
  count: number,
  other: readonly string[],
): { from: number; to: number; replacement: string } {
  const lineCount = text === "" ? 0 : text.endsWith("\n") ? starts.length - 1 : starts.length;
  const startOf = (index: number) => (index < starts.length ? starts[index] : text.length);
  if (count > 0 && other.length > 0) {
    const endOfLast = startOf(line + count) - (line + count < starts.length ? 1 : 0);
    return { from: startOf(line), to: endOfLast, replacement: other.join("\n") };
  }
  if (count > 0) {
    // Remove whole lines, newline included. At the end of the note there is no
    // following newline, so take the one before instead.
    if (line + count < lineCount) {
      return { from: startOf(line), to: startOf(line + count), replacement: "" };
    }
    const end = text.endsWith("\n") ? text.length - 1 : text.length;
    return { from: Math.max(0, startOf(line) - 1), to: end, replacement: "" };
  }
  if (line < lineCount) {
    const at = startOf(line);
    return { from: at, to: at, replacement: `${other.join("\n")}\n` };
  }
  const inserted = other.join("\n");
  if (text === "") {
    return { from: 0, to: 0, replacement: inserted };
  }
  return text.endsWith("\n")
    ? { from: text.length, to: text.length, replacement: `${inserted}\n` }
    : { from: text.length, to: text.length, replacement: `\n${inserted}` };
}
