/**
 * A colour typed by hand, as `#rrggbb`: with or without `#`, three or six
 * hex digits, any case. Anything else is not a colour.
 */
export function parseHexColor(text: string): string | null {
  const digits = text.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(digits)) return `#${digits.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(digits)) return `#${[...digits.toLowerCase()].map((digit) => digit + digit).join("")}`;
  return null;
}
