// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loginItem = vi.hoisted(() => ({
  loginItemStatus: vi.fn(),
  setLoginItem: vi.fn(),
  openLoginItemSettings: vi.fn(),
}));
vi.mock("../../lib/ipc/loginItemClient", () => loginItem);

import { OpenAtLoginSetting } from "./OpenAtLoginSetting";

const SWITCH = { name: "Open Compose at login" };

describe("the open-at-login setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loginItem.setLoginItem.mockImplementation(async (enabled: boolean) => (enabled ? "on" : "off"));
  });

  it("is off until turned on, then says the quick note is ready from login", async () => {
    loginItem.loginItemStatus.mockResolvedValue("off");
    render(<OpenAtLoginSetting />);
    expect(await screen.findByText(/The quick note works while Compose is open/)).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", SWITCH));
    expect(await screen.findByText(/Compose opens without a window when you log in/)).toBeTruthy();
    expect(loginItem.setLoginItem).toHaveBeenCalledWith(true);
  });

  it("says when it was switched off in System Settings, and opens Login Items to allow it", async () => {
    loginItem.loginItemStatus.mockResolvedValue("needsApproval");
    render(<OpenAtLoginSetting />);
    expect(await screen.findByText(/switched off under Login Items in System Settings/)).toBeTruthy();
    expect((screen.getByRole("switch", SWITCH) as HTMLButtonElement).getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Open Login Items" }));
    expect(loginItem.openLoginItemSettings).toHaveBeenCalled();
  });

  it("keeps the switch as it was and says why when macOS refuses", async () => {
    loginItem.loginItemStatus.mockResolvedValue("off");
    loginItem.setLoginItem.mockRejectedValue(new Error("Operation not permitted"));
    render(<OpenAtLoginSetting />);
    fireEvent.click(await screen.findByRole("switch", SWITCH));
    expect(await screen.findByText("Operation not permitted")).toBeTruthy();
    expect(screen.getByText(/The quick note works while Compose is open/)).toBeTruthy();
  });

  it("reads the switch again when Compose comes back to the front", async () => {
    loginItem.loginItemStatus.mockResolvedValueOnce("on").mockResolvedValueOnce("off");
    render(<OpenAtLoginSetting />);
    expect(await screen.findByText(/Compose opens without a window when you log in/)).toBeTruthy();

    fireEvent(window, new Event("focus"));
    expect(await screen.findByText(/The quick note works while Compose is open/)).toBeTruthy();
  });

  it("shows nothing where macOS cannot open Compose at login", async () => {
    loginItem.loginItemStatus.mockResolvedValue(null);
    const { container } = render(<OpenAtLoginSetting />);
    await vi.waitFor(() => expect(loginItem.loginItemStatus).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
