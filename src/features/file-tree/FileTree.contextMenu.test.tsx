// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const showNativeMenu = vi.fn(async () => undefined);
let native = true;

vi.mock("../../lib/runtime/nativeMenu", () => ({
  canShowNativeMenu: () => native,
  showNativeMenu: (...args: unknown[]) => showNativeMenu(...(args as [])),
}));

import { ConfirmProvider } from "../dialogs/ConfirmProvider";
import { TextPromptProvider } from "../dialogs/TextPromptProvider";
import { FileTree } from "./FileTree";

const files = [{ relativePath: "Plan.md", lastModifiedMs: 1, sizeBytes: 1 }];

function renderTree(onRename = vi.fn()) {
  render(
    <ConfirmProvider>
      <TextPromptProvider>
        <FileTree activePath="" files={files} folders={[]} onDelete={vi.fn()} onRename={onRename} onMoveFile={vi.fn()} onSelectFile={vi.fn()} />
      </TextPromptProvider>
    </ConfirmProvider>,
  );
  return onRename;
}

// jsdom lays nothing out, so the virtualised tree would measure itself as
// zero tall and draw no rows. Every element gets a window-sized box here.
const realRect = HTMLElement.prototype.getBoundingClientRect;
beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 300, 600);
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 300 });
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  showNativeMenu.mockClear();
  native = true;
});

describe("the tree's right-click menu", () => {
  it("inside Compose is the system's own menu, and its choice acts on the row clicked", () => {
    const onRename = renderTree();
    fireEvent.contextMenu(screen.getByTitle("Plan.md").closest("div")!, { clientX: 40, clientY: 60 });

    expect(showNativeMenu).toHaveBeenCalledTimes(1);
    const [entries, choose, at] = showNativeMenu.mock.calls[0] as unknown as [{ label?: string }[] | string[], (id: string) => void, { x: number; y: number }];
    expect((entries as ({ label?: string } | string)[]).map((entry) => (typeof entry === "string" ? entry : entry.label))).toEqual([
      "Rename…",
      "Copy Path",
      "Reveal in Finder",
      "separator",
      "Delete",
    ]);
    expect(at).toEqual({ x: 40, y: 60 });
    choose("rename");
    expect(onRename).toHaveBeenCalledWith("Plan.md");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("outside Compose opens the HTML menu instead", async () => {
    native = false;
    renderTree();
    fireEvent.contextMenu(screen.getByTitle("Plan.md").closest("div")!, { clientX: 40, clientY: 60 });
    expect(showNativeMenu).not.toHaveBeenCalled();
    expect(await screen.findByRole("menu")).toBeTruthy();
  });
});
