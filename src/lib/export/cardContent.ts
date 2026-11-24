import { parseFrontmatter, type FrontmatterValue } from "@latentic/live-markdown";

/**
 * The words on an image card, picked from the note: its front matter first
 * (`category`, `title`, `author`, `subtitle`, `date`, with common other
 * names), then its first heading or file name. The export dialog shows each
 * field to edit before the image is made.
 */

export interface CardContent {
  eyebrow: string;
  title: string;
  author: string;
  subtitle: string;
  date: string;
  quote: string;
  body: string;
}

const KEYS: Record<Exclude<keyof CardContent, "quote" | "body">, readonly string[]> = {
  eyebrow: ["category", "eyebrow", "kicker", "section", "series"],
  title: ["title"],
  author: ["author", "authors", "by"],
  subtitle: ["subtitle", "description", "summary", "abstract"],
  date: ["date", "year", "published"],
};

/** A front matter value as one line of text; lists are joined. */
function asText(value: FrontmatterValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ");
  if (typeof value === "object") return "";
  return String(value).trim();
}

function pick(frontmatter: Record<string, FrontmatterValue>, keys: readonly string[]): string {
  const lowered = new Map(Object.entries(frontmatter).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const text = asText(lowered.get(key));
    if (text) return text;
  }
  return "";
}

/** A date reads best on a card as its year, unless it is already words. */
function cardDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 4) : value;
}

/** Markdown marks off a line of prose: emphasis, code, links' brackets. */
function plain(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_match, target: string, _pipe, label?: string) => label ?? target)
    .replace(/[*_`~]+/g, "")
    .trim();
}

function firstHeading(body: string): string {
  const match = /^#{1,6}\s+(.+)$/m.exec(body);
  return match ? plain(match[1]) : "";
}

/** The first paragraph of prose: not a heading, list, quote, table or fence. */
function firstParagraph(body: string): string {
  for (const block of body.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || /^(#|[-*+]\s|\d+\.\s|>|\||```|~~~|---)/.test(text)) continue;
    return plain(text.replace(/\s*\n\s*/g, " "));
  }
  return "";
}

export function cardContentFor(markdown: string, fileName: string, selection = ""): CardContent {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const fields = frontmatter ?? {};
  const stem = fileName.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  return {
    eyebrow: pick(fields, KEYS.eyebrow),
    title: pick(fields, KEYS.title) || firstHeading(body) || stem,
    author: pick(fields, KEYS.author),
    subtitle: pick(fields, KEYS.subtitle),
    date: cardDate(pick(fields, KEYS.date)),
    quote: plain(selection.replace(/\s*\n\s*/g, " ")) || firstParagraph(body),
    body,
  };
}
