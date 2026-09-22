// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const finder = vi.hoisted(() => ({ finderExtensionEnabled: vi.fn(), openFinderExtensionSettings: vi.fn() }));
vi.mock("../../lib/ipc/finderExtensionClient", () => finder);

import { FinderSection } from "./FinderSection";

describe("the Finder setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    finder.openFinderExtensionSettings.mockResolvedValue(undefined);
  });

  it("says how to turn the extension on, and reads it again on return from System Settings", async () => {
    finder.finderExtensionEnabled.mockResolvedValue(false);
    render(<FinderSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on in System Settings" }));
    expect(finder.openFinderExtensionSettings).toHaveBeenCalled();

    finder.finderExtensionEnabled.mockResolvedValue(true);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText(/right-click a note to open it in Compose/)).toBeTruthy();
  });

  it("is left out of a copy that has no Finder extension", async () => {
    finder.finderExtensionEnabled.mockResolvedValue(null);
    const { container } = render(<FinderSection />);
    await act(async () => undefined);
    expect(container.textContent).toBe("");
  });
});
