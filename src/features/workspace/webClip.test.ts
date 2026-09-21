// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { pageMarkdown, selectionMarkdown } from "./webClip";

const PARAGRAPH =
  "Ifa is a system of divination and a body of literature, recited in verses that " +
  "carry history, ethics and medicine across generations of Yoruba practitioners. ";

const PAGE = `<!doctype html><html><head><title>Ifa: an exposition</title></head><body>
  <header><nav><a href="/">Home</a> <a href="/books">Books</a></nav></header>
  <main><article>
    <h1>Ifa: an exposition</h1>
    <p>${PARAGRAPH.repeat(4)}</p>
    <p>${PARAGRAPH.repeat(4)} Read <a href="../corpus">the corpus</a>.</p>
    <img src="images/opele.jpg" alt="Opele" width="800" height="600">
  </article></main>
  <footer>Copyright notice and newsletter signup</footer>
</body></html>`;

/** How documentation sites mark up a highlighted sample: a `pre` of spans, no `code`. */
const HIGHLIGHTED_SAMPLE = `<div class="highlight-python3"><div class="highlight"><pre><span class="gp">&gt;&gt;&gt; </span><span class="n">fruits</span> <span class="o">=</span> <span class="p">[</span><span class="s1">'orange'</span><span class="p">]</span>
<span class="gp">&gt;&gt;&gt; </span><span class="n">fruits</span><span class="o">.</span><span class="n">count</span><span class="p">(</span><span class="s1">'orange'</span><span class="p">)</span>
<span class="go">1</span>
</pre></div></div>`;

const URL_OF_PAGE = "https://thinkyorubafirst.org/books/ifa/";

describe("a shared web page", () => {
  it("keeps the article and drops the page around it", async () => {
    const markdown = await pageMarkdown(PAGE, URL_OF_PAGE);

    expect(markdown).toContain("Ifa is a system of divination");
    expect(markdown).not.toContain("newsletter signup");
    expect(markdown).not.toContain("[Books]");
  });

  it("makes its links and images absolute against where the page came from", async () => {
    const markdown = await pageMarkdown(PAGE, URL_OF_PAGE);

    expect(markdown).toContain("[the corpus](https://thinkyorubafirst.org/books/corpus)");
    expect(markdown).toContain("![Opele](https://thinkyorubafirst.org/books/ifa/images/opele.jpg)");
  });

  it("keeps a highlighted sample as a code block, not escaped prose", async () => {
    const page = PAGE.replace("</article>", `<p>${PARAGRAPH}</p>${HIGHLIGHTED_SAMPLE}</article>`);

    const markdown = await pageMarkdown(page, URL_OF_PAGE);

    expect(markdown).toContain("```\n>>> fruits = ['orange']\n>>> fruits.count('orange')\n1\n```");
  });

  it("finds nothing in a page with no article", async () => {
    await expect(pageMarkdown("<html><body></body></html>", "https://x.dev/")).resolves.toBeNull();
  });
});

describe("a selection from a web page", () => {
  it("is kept whole, even the parts a page would drop", async () => {
    const markdown = await selectionMarkdown(
      '<p>Worth keeping.</p><div class="share-buttons">Also chosen.</div><nav>This too.</nav>',
      URL_OF_PAGE,
    );

    expect(markdown).toContain("Worth keeping.");
    expect(markdown).toContain("Also chosen.");
    expect(markdown).toContain("This too.");
  });

  it("keeps a highlighted sample as a code block and resolves its links", async () => {
    const markdown = await selectionMarkdown(
      `<p>Count them:</p>${HIGHLIGHTED_SAMPLE}<p><a href="../corpus">More</a></p>`,
      URL_OF_PAGE,
    );

    expect(markdown).toContain("```\n>>> fruits = ['orange']");
    expect(markdown).toContain("[More](https://thinkyorubafirst.org/books/corpus)");
  });
});
