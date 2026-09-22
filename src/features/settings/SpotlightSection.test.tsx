// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spotlight = vi.hoisted(() => ({ spotlightEnabled: vi.fn(), setSpotlightEnabled: vi.fn() }));
vi.mock("../../lib/ipc/spotlightClient", () => spotlight);

import { SpotlightSection } from "./SpotlightSection";

describe("the Spotlight setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spotlight.setSpotlightEnabled.mockImplementation(async (enabled: boolean) => enabled);
  });

  it("shows notes in Spotlight until turned off, and says what that means", async () => {
    spotlight.spotlightEnabled.mockResolvedValue(true);
    render(<SpotlightSection />);
    expect(await screen.findByText(/Spotlight finds your notes by their titles and words/)).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "Show notes in Spotlight" }));
    expect(await screen.findByText(/Spotlight does not show your notes/)).toBeTruthy();
    expect(spotlight.setSpotlightEnabled).toHaveBeenCalledWith(false);
  });

  it("keeps the switch as it was and says why when the change fails", async () => {
    spotlight.spotlightEnabled.mockResolvedValue(false);
    spotlight.setSpotlightEnabled.mockRejectedValue(new Error("could not save the setting"));
    render(<SpotlightSection />);
    fireEvent.click(await screen.findByRole("switch", { name: "Show notes in Spotlight" }));
    expect(await screen.findByText("could not save the setting")).toBeTruthy();
    expect(screen.getByText(/Spotlight does not show your notes/)).toBeTruthy();
  });
});
