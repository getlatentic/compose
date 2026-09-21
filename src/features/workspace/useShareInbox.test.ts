// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { clipBody, type ClipConverters, type PendingClip } from "./useShareInbox";

const clip: PendingClip = { id: "1", url: null, html: null, text: null, page: null, markdown: null };

/** Converters that say which of them ran, and with what. */
function recording(): ClipConverters & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    page: async (page, url) => {
      calls.push(`page ${page} ${url}`);
      return page === "<html>page</html>" ? "The *article*." : null;
    },
    selection: async (html, url) => {
      calls.push(`selection ${html} ${url}`);
      return "The selection.";
    },
    richText: async (html) => {
      calls.push(`richText ${html}`);
      return "Rich text.";
    },
  };
}

const refuse: ClipConverters = {
  page: async () => {
    throw new Error("no converter may load");
  },
  selection: async () => {
    throw new Error("no converter may load");
  },
  richText: async () => {
    throw new Error("no converter may load");
  },
};

describe("clipBody", () => {
  it("converts rich text from an app with the converter a paste uses", async () => {
    await expect(
      clipBody({ ...clip, html: '<p>Rich <b>bold</b> and a <a href="https://x.dev">link</a>.</p>', text: "Rich" }),
    ).resolves.toBe("Rich **bold** and a [link](https://x.dev).");
  });

  it("converts a selection from a web page as web content, against its page", async () => {
    const convert = recording();

    await expect(
      clipBody({ ...clip, url: "https://x.dev/post", html: "<p>Just this.</p>", page: "<html>page</html>" }, convert),
    ).resolves.toBe("The selection.");
    expect(convert.calls).toEqual(["selection <p>Just this.</p> https://x.dev/post"]);
  });

  it("files a shared page by its article", async () => {
    const convert = recording();

    await expect(clipBody({ ...clip, url: "https://x.dev/post", page: "<html>page</html>" }, convert)).resolves.toBe(
      "The *article*.",
    );
    expect(convert.calls).toEqual(["page <html>page</html> https://x.dev/post"]);
  });

  it("keeps just the link when a page has no article", async () => {
    await expect(clipBody({ ...clip, url: "https://x.dev", page: "<html></html>" }, recording())).resolves.toBe("");
  });

  it("files the browser clipper's Markdown as it came", async () => {
    await expect(
      clipBody({ ...clip, url: "https://x.dev/post", markdown: "Already **Markdown**.", page: "<html>page</html>" }, refuse),
    ).resolves.toBe("Already **Markdown**.");
  });

  it("does not load a converter for plain text", async () => {
    await expect(clipBody({ ...clip, text: "plain" }, refuse)).resolves.toBe("plain");
  });

  it("is empty for a clip that is only a link or images", async () => {
    await expect(clipBody(clip, refuse)).resolves.toBe("");
  });
});
