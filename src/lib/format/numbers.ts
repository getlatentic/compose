/**
 * Human-readable number helpers for the chat surfaces (token / coin
 * totals). Compact so a big token count reads as "25.7k", not
 * "25,678,891" — calm at a glance for a non-technical audience.
 */

const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** A token count as a compact figure, straight from `Intl`: 678 → "678",
 * 25_678 → "25.7K", 1_200_000 → "1.2M". */
export function formatCompact(value: number): string {
  return COMPACT.format(value);
}

/** A coin amount: trims to at most 2 decimals, dropping trailing zeros
 * (0.5 → "0.5", 0.052757 → "0.05", 3 → "3"). */
export function formatCoins(value: number): string {
  return Number(value.toFixed(2)).toString();
}
