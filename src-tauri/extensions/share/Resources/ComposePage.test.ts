// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

const SCRIPT = readFileSync("src-tauri/extensions/share/Resources/ComposePage.js", "utf8");

interface PageResults {
  url: string;
  title: string;
  selection: string;
  page: string;
}

/** Runs the script the way Safari does: evaluated in the page, then `run` called. */
function share(): PageResults {
  const preprocessing = new Function(`${SCRIPT}\nreturn ExtensionPreprocessingJS;`)() as {
    run(parameters: { completionFunction(results: PageResults): void }): void;
  };
  let results: PageResults | undefined;
  preprocessing.run({ completionFunction: (value) => (results = value) });
  if (!results) throw new Error("completionFunction was never called");
  return results;
}

describe("the script Safari runs in a shared page", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/blog/post");
    document.title = "A Post";
    document.body.innerHTML = `
      <nav><a href="/">Home</a></nav>
      <article><h1>A Post</h1><p id="p">Words with <a href="../about">a link</a>.</p><img src="img/a.png"></article>
      <script>window.tracker = 1</script>
      <style>body { color: red }</style>`;
    window.getSelection()?.removeAllRanges();
  });

  it("returns the page, its address and title, without scripts or styles", () => {
    const results = share();

    expect(results.url).toBe(window.location.href);
    expect(results.title).toBe("A Post");
    expect(results.selection).toBe("");
    expect(results.page).toContain("<article>");
    expect(results.page).not.toContain("window.tracker");
    expect(results.page).not.toContain("color: red");
  });

  it("returns only the selection when there is one, with its links made absolute", () => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("p")!);
    window.getSelection()!.addRange(range);

    const results = share();

    expect(results.page).toBe("");
    expect(results.selection).toContain("Words with");
    expect(results.selection).toContain(`href="${new URL("../about", window.location.href).href}"`);
    expect(results.selection).not.toContain("Home");
  });

  it("leaves the page itself untouched", () => {
    share();
    expect(document.querySelector("script")).not.toBeNull();
    expect(document.querySelector("a[href='../about']")).not.toBeNull();
  });
});
