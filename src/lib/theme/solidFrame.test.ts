// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const solid = vi.hoisted(() => ({ value: true }));
vi.mock("../ipc/accessibilityClient", () => ({ solidWindowFrame: vi.fn(async () => solid.value) }));

import { trackWindowFocus } from "./windowChrome";

describe("the solid window frame", () => {
  it("follows the Mac's transparency setting, read again when the window comes to the front", async () => {
    const root = document.createElement("div");
    const stop = trackWindowFocus(root);
    await vi.waitFor(() => expect(root.hasAttribute("data-solid-frame")).toBe(true));

    solid.value = false;
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(root.hasAttribute("data-solid-frame")).toBe(false));
    stop();
  });
});
