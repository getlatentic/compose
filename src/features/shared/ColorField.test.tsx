// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ColorField } from "./ColorField";

afterEach(cleanup);

describe("ColorField", () => {
  it("takes a typed hex code on Return", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorField value="#f4efe6" onChange={onChange} label="Background colour" />);
    const hex = screen.getByLabelText("Background colour, hex");
    expect(hex).toHaveProperty("value", "#F4EFE6");
    await user.clear(hex);
    await user.type(hex, "1c1b1a{Enter}");
    expect(onChange).toHaveBeenCalledWith("#1c1b1a");
  });

  it("goes back to the current colour when the entry is not one", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorField value="#f4efe6" onChange={onChange} label="Background colour" />);
    const hex = screen.getByLabelText("Background colour, hex");
    await user.clear(hex);
    await user.type(hex, "nope");
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(hex).toHaveProperty("value", "#F4EFE6");
  });
});
