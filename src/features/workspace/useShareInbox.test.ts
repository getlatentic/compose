// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { clipBody, type PendingClip } from "./useShareInbox";

const clip: PendingClip = { id: "1", url: null, html: null, text: null, page: null };

describe("clipBody", () => {
  it("converts shared HTML with the converter a paste uses", async () => {
    await expect(
      clipBody({ ...clip, html: "<p>Rich <b>bold</b> and a <a href=\"https://x.dev\">link</a>.</p>", text: "Rich" }),
    ).resolves.toBe("Rich **bold** and a [link](https://x.dev).");
  });

  it("does not load the converter for plain text", async () => {
    const converter = async () => {
      throw new Error("the converter must not load");
    };
    await expect(clipBody({ ...clip, text: "plain" }, converter)).resolves.toBe("plain");
  });

  it("is empty for a clip that is only a link or images", async () => {
    await expect(clipBody(clip)).resolves.toBe("");
  });

  it("files a shared page by its article", async () => {
    const findArticle = async (page: string, url: string | null) =>
      page === "<html>page</html>" && url === "https://x.dev/post" ? "<p>The <em>article</em>.</p>" : null;

    await expect(
      clipBody({ ...clip, url: "https://x.dev/post", page: "<html>page</html>" }, undefined, findArticle),
    ).resolves.toBe("The *article*.");
  });

  it("prefers a selection to the page it came from", async () => {
    const findArticle = async () => {
      throw new Error("a selection is filed as it is");
    };
    await expect(
      clipBody({ ...clip, html: "<p>Just this.</p>", page: "<html>page</html>" }, undefined, findArticle),
    ).resolves.toBe("Just this.");
  });

  it("keeps just the link when a page has no article", async () => {
    await expect(
      clipBody({ ...clip, url: "https://x.dev", page: "<html></html>" }, undefined, async () => null),
    ).resolves.toBe("");
  });
});
