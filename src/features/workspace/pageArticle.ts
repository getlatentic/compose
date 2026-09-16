/**
 * The article in a web page shared from Safari, as HTML. Readability picks it
 * out of the page's navigation, sidebars and footers, as Safari's Reader does;
 * `null` when it finds none, and the clip keeps just its link.
 */
export async function pageArticle(page: string, url: string | null): Promise<string | null> {
  const { Readability } = await import("@mozilla/readability");
  const document = new DOMParser().parseFromString(page, "text/html");
  if (url) resolveAgainst(document, url);
  const content = new Readability(document).parse()?.content?.trim();
  return content ? content : null;
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
