// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RenameProvider, useRename } from "./RenameProvider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let rename: (path: string) => Promise<string | null>;

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function Harness() {
  rename = useRename();
  return null;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<RenameProvider><Harness /></RenameProvider>));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const input = () => document.getElementById("rename-input") as HTMLInputElement;
const renameButton = () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Rename")!;

function typeName(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the rename dialog", () => {
  it("says why a name with a slash is refused, and will not submit it", () => {
    act(() => void rename("Notes/Plan.md"));
    typeName("Ideas/Plan");
    expect(document.body.textContent).toContain("A name cannot contain");
    expect(renameButton().disabled).toBe(true);
  });

  it("renames to a good name, keeping the folder and extension", async () => {
    let result: Promise<string | null> = Promise.resolve(null);
    act(() => void (result = rename("Notes/Plan.md")));
    typeName("Roadmap");
    expect(renameButton().disabled).toBe(false);
    act(() => renameButton().click());
    await expect(result).resolves.toBe("Notes/Roadmap.md");
  });
});
