const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 24 * 3600_000],
  ["hour", 3600_000],
  ["minute", 60_000],
];

/** How long ago `time` was, in the user's language: "5 min. ago", "yesterday". */
export function timeAgo(time: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - time);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return format.format(-Math.floor(elapsed / size), unit);
  }
  return format.format(0, "minute");
}
