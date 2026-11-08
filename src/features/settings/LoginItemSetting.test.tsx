// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loginItem = vi.hoisted(() => ({
  loginItemStatus: vi.fn(),
  setLoginItem: vi.fn(),
  openLoginItemSettings: vi.fn(),
}));
vi.mock("../../lib/ipc/loginItemClient", () => loginItem);

import type { LoginItemService } from "../../lib/ipc/loginItemClient";
import { LoginItemSetting } from "./LoginItemSetting";

const HELP = { on: "It runs at login.", off: "It does not run at login.", needsApproval: "It is switched off in System Settings." };
const SWITCH = { name: "Run at login" };

function renderSetting(service: LoginItemService = "app") {
  return render(<LoginItemSetting service={service} id="run-at-login" label="Run at login" help={HELP} />);
}

describe("a login-item setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loginItem.setLoginItem.mockImplementation(async (_service: LoginItemService, enabled: boolean) => (enabled ? "on" : "off"));
  });

  it("is off until turned on, then says what that means", async () => {
    loginItem.loginItemStatus.mockResolvedValue("off");
    renderSetting();
    expect(await screen.findByText(HELP.off)).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", SWITCH));
    expect(await screen.findByText(HELP.on)).toBeTruthy();
    expect(loginItem.setLoginItem).toHaveBeenCalledWith("app", true);
  });

  it("asks about and changes the service it is for", async () => {
    loginItem.loginItemStatus.mockResolvedValue("off");
    renderSetting("shortcutsHelper");
    fireEvent.click(await screen.findByRole("switch", SWITCH));
    await screen.findByText(HELP.on);
    expect(loginItem.loginItemStatus).toHaveBeenCalledWith("shortcutsHelper");
    expect(loginItem.setLoginItem).toHaveBeenCalledWith("shortcutsHelper", true);
  });

  it("says when it was switched off in System Settings, and opens Login Items to allow it", async () => {
    loginItem.loginItemStatus.mockResolvedValue("needsApproval");
    renderSetting();
    expect(await screen.findByText(HELP.needsApproval)).toBeTruthy();
    expect((screen.getByRole("switch", SWITCH) as HTMLButtonElement).getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Open Login Items" }));
    expect(loginItem.openLoginItemSettings).toHaveBeenCalled();
  });

  it("keeps the switch as it was and says why when macOS refuses", async () => {
    loginItem.loginItemStatus.mockResolvedValue("off");
    loginItem.setLoginItem.mockRejectedValue(new Error("Operation not permitted"));
    renderSetting();
    fireEvent.click(await screen.findByRole("switch", SWITCH));
    expect(await screen.findByText("Operation not permitted")).toBeTruthy();
    expect(screen.getByText(HELP.off)).toBeTruthy();
  });

  it("reads the switch again when Compose comes back to the front", async () => {
    loginItem.loginItemStatus.mockResolvedValueOnce("on").mockResolvedValueOnce("off");
    renderSetting();
    expect(await screen.findByText(HELP.on)).toBeTruthy();

    fireEvent(window, new Event("focus"));
    expect(await screen.findByText(HELP.off)).toBeTruthy();
  });

  it("shows nothing where it cannot run at login", async () => {
    loginItem.loginItemStatus.mockResolvedValue(null);
    const { container } = renderSetting("shortcutsHelper");
    await vi.waitFor(() => expect(loginItem.loginItemStatus).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
