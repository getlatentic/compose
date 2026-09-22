// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => ({
  captureShortcuts: vi.fn(),
  setCaptureShortcut: vi.fn(),
}));
vi.mock("../../lib/ipc/captureClient", () => capture);

const clipboard = vi.hoisted(() => ({
  clipboardHistoryEnabled: vi.fn(),
  setClipboardHistoryEnabled: vi.fn(),
  clearClipboardHistory: vi.fn(),
}));
vi.mock("../../lib/ipc/clipboardClient", () => clipboard);

import { QuickCaptureSection } from "./QuickCaptureSection";

const NOTES = "Control+Alt+KeyN";
const CLIPBOARD = "Control+Alt+KeyV";

function section(title: string): HTMLElement {
  return screen.getByRole("heading", { name: title }).closest(".settings-section") as HTMLElement;
}

describe("the quick note settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let shortcuts = { notes: { current: NOTES, default: NOTES }, clipboard: { current: CLIPBOARD, default: CLIPBOARD } };
    capture.captureShortcuts.mockImplementation(async () => shortcuts);
    capture.setCaptureShortcut.mockImplementation(async (view: "notes" | "clipboard", shortcut: string | null) => {
      shortcuts = { ...shortcuts, [view]: { ...shortcuts[view], current: shortcut } };
      return shortcuts;
    });
    clipboard.clipboardHistoryEnabled.mockResolvedValue(false);
    clipboard.setClipboardHistoryEnabled.mockImplementation(async (enabled: boolean) => enabled);
    clipboard.clearClipboardHistory.mockResolvedValue(undefined);
  });

  it("shows both shortcuts as macOS writes them", async () => {
    render(<QuickCaptureSection />);
    expect(await screen.findByText(/Press ⌃⌥N in any app to jot an idea/)).toBeTruthy();
    expect(screen.getByText(/Press ⌃⌥V in any app to find what you copied/)).toBeTruthy();
  });

  it("records the next shortcut pressed for the notes, and registers it for them alone", async () => {
    render(<QuickCaptureSection />);
    await screen.findByText(/Press ⌃⌥N/);
    fireEvent.click(within(section("Quick note")).getByRole("button", { name: "Change shortcut" }));
    fireEvent.keyDown(window, { code: "ShiftLeft", shiftKey: true });
    fireEvent.keyDown(window, { code: "KeyI", metaKey: true, shiftKey: true });

    await waitFor(() => expect(capture.setCaptureShortcut).toHaveBeenCalledWith("notes", "Shift+Super+KeyI"));
    expect(await screen.findByText(/Press ⇧⌘I in any app to jot an idea/)).toBeTruthy();
    expect(screen.getByText(/Press ⌃⌥V in any app/)).toBeTruthy();
  });

  it("keeps the old shortcut and says why when the system refuses the new one", async () => {
    capture.setCaptureShortcut.mockRejectedValue(new Error("Control+Alt+KeyN already opens the other part of the quick-note window."));
    render(<QuickCaptureSection />);
    await screen.findByText(/Press ⌃⌥V/);
    fireEvent.click(within(section("Clipboard history")).getByRole("button", { name: "Change shortcut" }));
    fireEvent.keyDown(window, { code: "KeyN", ctrlKey: true, altKey: true });

    expect(await screen.findByText(/already opens the other part/)).toBeTruthy();
    expect(screen.getByText(/Press ⌃⌥V in any app/)).toBeTruthy();
  });

  it("turns a shortcut off, and stops recording on Esc without changing anything", async () => {
    render(<QuickCaptureSection />);
    await screen.findByText(/Press ⌃⌥N/);
    fireEvent.click(within(section("Clipboard history")).getByRole("button", { name: "Change shortcut" }));
    fireEvent.keyDown(window, { code: "Escape" });
    expect(capture.setCaptureShortcut).not.toHaveBeenCalled();

    fireEvent.click(within(section("Quick note")).getByRole("button", { name: "Turn off" }));
    expect(await screen.findByText(/^Off\./)).toBeTruthy();
    expect(capture.setCaptureShortcut).toHaveBeenCalledWith("notes", null);
  });

  it("turns clipboard history on, and clears it", async () => {
    render(<QuickCaptureSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Keep what I copy" }));
    expect(await screen.findByText(/Keeping what you copy in any app/)).toBeTruthy();
    expect(clipboard.setClipboardHistoryEnabled).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(await screen.findByText(/History cleared; pinned copies stay/)).toBeTruthy();
  });
});
