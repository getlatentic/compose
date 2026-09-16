// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { pageArticle } from "./pageArticle";

const PARAGRAPH =
  "Ifa is a system of divination and a body of literature, recited in verses that " +
  "carry history, ethics and medicine across generations of Yoruba practitioners. ";

const PAGE = `<!doctype html><html><head><title>Ifa: an exposition</title></head><body>
  <header><nav><a href="/">Home</a> <a href="/books">Books</a></nav></header>
  <main><article>
    <h1>Ifa: an exposition</h1>
    <p>${PARAGRAPH.repeat(4)}</p>
    <p>${PARAGRAPH.repeat(4)} Read <a href="../corpus">the corpus</a>.</p>
    <img src="images/opele.jpg" alt="Opele">
  </article></main>
  <footer>Copyright notice and newsletter signup</footer>
</body></html>`;

describe("the article in a shared page", () => {
  it("keeps the article and drops the page around it", async () => {
    const html = await pageArticle(PAGE, "https://thinkyorubafirst.org/books/ifa/");

    expect(html).toContain("Ifa is a system of divination");
    expect(html).not.toContain("newsletter signup");
    expect(html).not.toContain(">Books<");
  });

  it("makes its links and images absolute against where the page came from", async () => {
    const html = await pageArticle(PAGE, "https://thinkyorubafirst.org/books/ifa/");

    expect(html).toContain('href="https://thinkyorubafirst.org/books/corpus"');
    expect(html).toContain('src="https://thinkyorubafirst.org/books/ifa/images/opele.jpg"');
  });

  it("finds nothing in a page with no article", async () => {
    await expect(pageArticle("<html><body></body></html>", "https://x.dev/")).resolves.toBeNull();
  });
});
