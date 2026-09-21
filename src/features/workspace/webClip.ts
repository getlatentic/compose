/**
 * Web content as Markdown, through Defuddle, the extractor behind Obsidian's
 * Web Clipper. Before converting it normalises the markup sites dress content
 * in, so highlighted code stays a code block, references become footnotes, and
 * math stays math.
 *
 * A whole page gives up its article: navigation, sidebars and footers go. A
 * selection is kept whole and only normalised. Nothing is fetched: some of
 * Defuddle's site extractors call third-party APIs, which a clip should not.
 */

type Defuddle = typeof import("defuddle/full").default;

const PAGE = { markdown: true, useAsync: false } as const;

/** What the user selected is what they meant to keep. */
const SELECTION = {
  ...PAGE,
  removeExactSelectors: false,
  removePartialSelectors: false,
  removeLowScoring: false,
  removeContentPatterns: false,
} as const;

async function loadDefuddle(): Promise<Defuddle> {
  // Loaded only when a web clip arrives, so it stays out of the launch bundle.
  return (await import("defuddle/full")).default;
}

/** The Markdown of a shared page's article, or `null` when it has none. */
export async function pageMarkdown(page: string, url: string | null): Promise<string | null> {
  const Defuddle = await loadDefuddle();
  const options = url ? { ...PAGE, url } : PAGE;
  const markdown = new Defuddle(parse(page, url), options).parse().content?.trim();
  return markdown ? markdown : null;
}

/** The Markdown of a selection from the page at `url`. */
export async function selectionMarkdown(html: string, url: string): Promise<string> {
  const Defuddle = await loadDefuddle();
  const document = parse(`<!doctype html><html><head></head><body>${html}</body></html>`, url);
  return new Defuddle(document, { ...SELECTION, url }).parse().content?.trim() ?? "";
}

function parse(html: string, url: string | null): Document {
  const document = new DOMParser().parseFromString(html, "text/html");
  if (url) resolveAgainst(document, url);
  return document;
}

/** Relative links and images resolve against the address the page came from. */
function resolveAgainst(document: Document, url: string): void {
  let href: string;
  const existing = document.querySelector("base[href]");
  try {
    href = new URL(existing?.getAttribute("href") ?? "", url).href;
  } catch {
    return;
  }
  const base = existing ?? document.head.insertBefore(document.createElement("base"), document.head.firstChild);
  base.setAttribute("href", href);
}
