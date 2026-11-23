import { beforeEach, describe, expect, it, vi } from "vitest";

const { copyCardImage, openUrl, showToast } = vi.hoisted(() => ({
  copyCardImage: vi.fn(async (_spec: unknown) => undefined),
  openUrl: vi.fn(async (_url: string) => undefined),
  showToast: vi.fn(),
}));

vi.mock("../../lib/ipc/cardExportClient", () => ({ copyCardImage, shareCardImage: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("../toast/toastStore", () => ({ showToast }));

import type { CardSpec } from "../../lib/ipc/cardExportClient";
import { X_COMPOSE_URL, copyCard, postCardOnX } from "./cardSharing";

const SPEC = { content: { title: "Private plans" } } as unknown as CardSpec;

describe("cardSharing", () => {
  beforeEach(() => {
    copyCardImage.mockClear();
    openUrl.mockClear();
    showToast.mockClear();
  });

  it("puts the card on the clipboard before opening X's empty composer, with no note text in the link", async () => {
    await postCardOnX(SPEC);
    expect(copyCardImage).toHaveBeenCalledWith(SPEC);
    expect(copyCardImage.mock.invocationCallOrder[0]).toBeLessThan(openUrl.mock.invocationCallOrder[0]);
    expect(openUrl).toHaveBeenCalledWith(X_COMPOSE_URL);
    expect(X_COMPOSE_URL).not.toContain("Private");
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: "Paste it into your post with ⌘V." }));
  });

  it("does not open X when the copy failed, and says why", async () => {
    copyCardImage.mockRejectedValueOnce(new Error("no clipboard"));
    await postCardOnX(SPEC);
    expect(openUrl).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", message: "no clipboard" }));
  });

  it("confirms a copy", async () => {
    expect(await copyCard(SPEC)).toBe(true);
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Image copied" }));
  });
});
