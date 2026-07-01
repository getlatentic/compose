// @vitest-environment jsdom
//
// The tab strip overflows horizontally, so a tab opened off-screen (from
// search or the file tree) must be scrolled into view when it becomes active.
// jsdom's scrollIntoView is a no-op, so we spy on it and assert the effect
// targets the active tab. Mounted with react-dom/client + React's `act` (no
// RTL dep), like the other editor / chat tests.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceFileEntry } from "../file-tree/fileTreeTypes";
import { PaneTabs, type EditorTab } from "./PaneTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let scrollIntoView: ReturnType<typeof vi.fn>;

function tab(relativePath: string): EditorTab {
  const entry: WorkspaceFileEntry = { lastModifiedMs: 0, relativePath, sizeBytes: 0 };
  return { entry };
}

const noop = () => {};

function render(files: EditorTab[], activeFilePath: string): void {
  act(() => {
    root.render(
      <PaneTabs
        activeFilePath={activeFilePath}
        files={files}
        onCloseFile={noop}
        onSelectFile={noop}
        onReorderTab={noop}
      />,
    );
  });
}

function activeTab(): HTMLElement | null {
  return container.querySelector(".editor-tab--active");
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("PaneTabs scroll-into-view", () => {
  it("scrolls the active tab into view on the active-path change", () => {
    render([tab("a.md"), tab("b.md")], "a.md");
    scrollIntoView.mockClear();

    render([tab("a.md"), tab("b.md")], "b.md");

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(activeTab());
  });

  it("scrolls into view when a newly opened tab becomes active", () => {
    render([tab("a.md")], "a.md");
    scrollIntoView.mockClear();

    // Opening from search appends a tab and makes it active.
    render([tab("a.md"), tab("b.md"), tab("c.md")], "c.md");

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(activeTab()?.getAttribute("title")).toBe("c.md");
  });
});
