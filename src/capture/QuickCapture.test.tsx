// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptureApi } from "./captureApi";
import { QuickCapture } from "./QuickCapture";

function fakeApi(overrides: Partial<CaptureApi> = {}) {
  let shown: (() => void) | null = null;
  const api: CaptureApi = {
    save: vi.fn(async () => true),
    close: vi.fn(async () => {}),
    destination: vi.fn(async () => "My Notes"),
    onShown: vi.fn(async (callback: () => void) => {
      shown = callback;
      return () => {
        shown = null;
      };
    }),
    ...overrides,
  };
  return { api, show: () => shown?.() };
}

function editor(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Quick note" });
}

function type(text: string) {
  fireEvent.change(editor(), { target: { value: text } });
}

function press(key: string, modifiers: { metaKey?: boolean } = {}) {
  fireEvent.keyDown(editor(), { key, ...modifiers });
}

describe("quick capture", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("takes the keyboard and says where the note will go", async () => {
    const { api } = fakeApi();
    render(<QuickCapture api={api} />);

    expect(document.activeElement).toBe(editor());
    expect(await screen.findByText("Saves to My Notes")).toBeTruthy();
  });

  it("saves on ⌘↩ and starts empty for the next idea", async () => {
    const { api } = fakeApi();
    render(<QuickCapture api={api} />);

    type("Call the printer");
    press("Enter", { metaKey: true });

    await waitFor(() => expect(editor().value).toBe(""));
    expect(api.save).toHaveBeenCalledWith("Call the printer");
  });

  it("does not save nothing", () => {
    const { api } = fakeApi();
    render(<QuickCapture api={api} />);

    type("   \n ");
    press("Enter", { metaKey: true });

    expect(api.save).not.toHaveBeenCalled();
  });

  it("puts the idea away on Esc without losing it", () => {
    const { api } = fakeApi();
    const { unmount } = render(<QuickCapture api={api} />);

    type("half a thought");
    press("Escape");

    expect(api.close).toHaveBeenCalled();
    expect(editor().value).toBe("half a thought");
    unmount();
    render(<QuickCapture api={api} />);
    expect(editor().value).toBe("half a thought");
  });

  it("keeps the text and says why when saving fails", async () => {
    const { api } = fakeApi({
      save: vi.fn(async () => {
        throw new Error("Open a workspace in Compose first");
      }),
    });
    render(<QuickCapture api={api} />);

    type("an idea");
    press("Enter", { metaKey: true });

    expect((await screen.findByRole("alert")).textContent).toBe("Open a workspace in Compose first");
    expect(editor().value).toBe("an idea");
  });

  it("takes the keyboard again each time it is shown", async () => {
    const { api, show } = fakeApi();
    render(<QuickCapture api={api} />);
    await waitFor(() => expect(api.onShown).toHaveBeenCalled());

    editor().blur();
    act(() => show());

    expect(document.activeElement).toBe(editor());
    await waitFor(() => expect(api.destination).toHaveBeenCalledTimes(2));
  });
});
