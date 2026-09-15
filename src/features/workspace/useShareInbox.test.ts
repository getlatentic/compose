// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { clipBody } from "./useShareInbox";

describe("clipBody", () => {
  it("converts shared HTML with the converter a paste uses", async () => {
    await expect(
      clipBody({ id: "1", html: "<p>Rich <b>bold</b> and a <a href=\"https://x.dev\">link</a>.</p>", text: "Rich" }),
    ).resolves.toBe("Rich **bold** and a [link](https://x.dev).");
  });

  it("does not load the converter for plain text", async () => {
    const converter = async () => {
      throw new Error("the converter must not load");
    };
    await expect(clipBody({ id: "1", html: null, text: "plain" }, converter)).resolves.toBe("plain");
  });

  it("is empty for a clip that is only a link or images", async () => {
    await expect(clipBody({ id: "1", html: null, text: null })).resolves.toBe("");
  });
});
