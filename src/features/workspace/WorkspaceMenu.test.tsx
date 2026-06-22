// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceMenuView, type WorkspaceMenuViewProps } from "./WorkspaceMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const items: WorkspaceMenuViewProps["items"] = [
  { id: "a", name: "notes", path: "/Users/dev/Documents/notes", isActive: true },
  { id: "b", name: "MSC Thesis", path: "/Users/dev/workspace/thesis", isActive: false },
];

function render(overrides: Partial<WorkspaceMenuViewProps> = {}) {
  const props: WorkspaceMenuViewProps = {
    activeName: "notes",
    activePath: "/Users/dev/Documents/notes",
    items,
    showSample: false,
    onOpenWorkspace: vi.fn(),
    onRemove: vi.fn(),
    onOpenFolder: vi.fn(),
    onOpenSample: vi.fn(),
    ...overrides,
  };
  act(() => root.render(<WorkspaceMenuView {...props} />));
  return props;
}

function clickEl(el: Element | null | undefined) {
  act(() => {
    (el as HTMLElement).click();
  });
}

// The dropdown is portaled to <body>, so query the document, not `container`.
const popover = () => document.querySelector(".workspace-switcher__popover");
const rows = () => Array.from(document.querySelectorAll(".ws-item"));

describe("WorkspaceMenuView", () => {
  it("shows the active workspace in the trigger and stays closed initially", () => {
    render();
    expect(container.querySelector(".workspace-switcher__name")?.textContent).toBe("notes");
    expect(popover()).toBeNull();
  });

  it("opens to one row per workspace; active is checked, inactive is removable", () => {
    render();
    clickEl(container.querySelector(".workspace-switcher__trigger"));

    expect(popover()).not.toBeNull();
    expect(rows()).toHaveLength(2);

    const active = document.querySelector(".ws-item--active");
    expect(active?.querySelector(".ws-item__check")).not.toBeNull();
    expect(active?.querySelector(".ws-item__remove")).toBeNull(); // can't forget the open folder

    const inactive = rows()[1];
    expect(inactive.classList.contains("ws-item--active")).toBe(false);
    expect(inactive.querySelector(".ws-item__remove")).not.toBeNull();
    expect(inactive.querySelector(".ws-item__path")?.textContent).toBe("~/workspace/thesis");
  });

  it("fires open and remove callbacks with the workspace id", () => {
    const props = render();
    clickEl(container.querySelector(".workspace-switcher__trigger"));

    clickEl(rows()[1].querySelector(".ws-item__remove"));
    expect(props.onRemove).toHaveBeenCalledWith("b");

    clickEl(rows()[1].querySelector(".ws-item__open"));
    expect(props.onOpenWorkspace).toHaveBeenCalledWith("b");
  });

  it("always offers Open a folder…", () => {
    render();
    clickEl(container.querySelector(".workspace-switcher__trigger"));
    expect(document.querySelector(".workspace-switcher__footer")?.textContent).toContain(
      "Open a folder",
    );
  });
});
