// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  captureShortcut: vi.fn(),
  setCaptureShortcut: vi.fn(),
}));
vi.mock("../../lib/ipc/captureClient", () => client);

import { QuickCaptureSection } from "./QuickCaptureSection";

const DEFAULT = "Control+Alt+KeyN";

describe("the quick note setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.captureShortcut.mockResolvedValue({ current: DEFAULT, default: DEFAULT });
    client.setCaptureShortcut.mockImplementation(async (shortcut: string | null) => ({
      current: shortcut,
      default: DEFAULT,
    }));
  });

  it("shows the shortcut as macOS writes it", async () => {
    render(<QuickCaptureSection />);
    expect(await screen.findByText(/Press ⌃⌥N in any app/)).toBeTruthy();
  });

  it("records the next shortcut pressed and registers it", async () => {
    render(<QuickCaptureSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Change shortcut" }));

    fireEvent.keyDown(window, { code: "ShiftLeft", shiftKey: true });
    fireEvent.keyDown(window, { code: "KeyI", metaKey: true, shiftKey: true });

    await waitFor(() => expect(client.setCaptureShortcut).toHaveBeenCalledWith("Shift+Super+KeyI"));
    expect(await screen.findByText(/Press ⇧⌘I in any app/)).toBeTruthy();
  });

  it("keeps the old shortcut and says why when the system refuses the new one", async () => {
    client.setCaptureShortcut.mockRejectedValue(new Error("Super+Space could not be registered (RegisterEventHotKey failed)"));
    render(<QuickCaptureSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Change shortcut" }));

    fireEvent.keyDown(window, { code: "Space", metaKey: true });

    expect(await screen.findByText(/Super\+Space could not be registered/)).toBeTruthy();
    expect(screen.getByText(/Press ⌃⌥N in any app/)).toBeTruthy();
  });

  it("can be turned off, and on again", async () => {
    render(<QuickCaptureSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn off" }));
    expect(await screen.findByText(/^Off\./)).toBeTruthy();
    expect(client.setCaptureShortcut).toHaveBeenCalledWith(null);
  });

  it("stops recording on Esc without changing anything", async () => {
    render(<QuickCaptureSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Change shortcut" }));
    fireEvent.keyDown(window, { code: "Escape" });

    expect(await screen.findByText(/Press ⌃⌥N in any app/)).toBeTruthy();
    expect(client.setCaptureShortcut).not.toHaveBeenCalled();
  });
});
