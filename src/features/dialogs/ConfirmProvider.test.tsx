// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider, useConfirm, type ConfirmOptions } from "./ConfirmProvider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let confirm: (options: ConfirmOptions) => Promise<boolean>;

// Carbon's Modal observes its size via ResizeObserver, which jsdom lacks.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function Harness() {
  confirm = useConfirm();
  return null;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <ConfirmProvider>
        <Harness />
      </ConfirmProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const openModal = () => document.querySelector(".cds--modal.is-visible");

function footerButton(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll(".cds--modal-footer button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) {
    throw new Error(`No footer button labelled "${text}"`);
  }
  return button as HTMLButtonElement;
}

// `confirm` resolves synchronously inside the click handler's state updater, so
// the promise is settled by the time `act` returns — awaiting it just reads the
// value.
function ask(options: ConfirmOptions): Promise<boolean> {
  let promise!: Promise<boolean>;
  act(() => {
    promise = confirm(options);
  });
  return promise;
}

describe("ConfirmProvider", () => {
  it("stays closed until asked", () => {
    expect(openModal()).toBeNull();
  });

  it("shows the title and message, then resolves true when confirmed", async () => {
    const promise = ask({
      title: "Delete file",
      message: "Delete note.md? This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });

    expect(openModal()).not.toBeNull();
    expect(document.body.textContent).toContain("Delete file");
    expect(document.body.textContent).toContain("Delete note.md? This cannot be undone.");

    act(() => footerButton("Delete").click());
    await expect(promise).resolves.toBe(true);
    expect(openModal()).toBeNull();
  });

  it("resolves false when cancelled", async () => {
    const promise = ask({ title: "Delete file", message: "Delete note.md?", confirmLabel: "Delete" });

    act(() => footerButton("Cancel").click());
    await expect(promise).resolves.toBe(false);
    expect(openModal()).toBeNull();
  });

  it("resolves false when dismissed via the close control", async () => {
    const promise = ask({ title: "Delete file", message: "Delete note.md?" });

    act(() => (document.querySelector(".cds--modal-close") as HTMLButtonElement).click());
    await expect(promise).resolves.toBe(false);
  });

  it("defaults the buttons to OK / Cancel", () => {
    void ask({ title: "Confirm", message: "Proceed?" });
    expect(footerButton("OK")).toBeTruthy();
    expect(footerButton("Cancel")).toBeTruthy();
  });

  it("styles the confirm button as danger only when requested", () => {
    void ask({ title: "Delete", message: "Delete?", confirmLabel: "Delete", danger: true });
    expect(footerButton("Delete").classList.contains("cds--btn--danger")).toBe(true);

    act(() => footerButton("Cancel").click());

    void ask({ title: "Export", message: "Export?", confirmLabel: "Export" });
    expect(footerButton("Export").classList.contains("cds--btn--danger")).toBe(false);
    expect(footerButton("Export").classList.contains("cds--btn--primary")).toBe(true);
  });

  it("throws when used outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const lone = createRoot(document.createElement("div"));
    expect(() => act(() => lone.render(<Harness />))).toThrow(
      /useConfirm must be used within a ConfirmProvider/,
    );
    spy.mockRestore();
  });
});
