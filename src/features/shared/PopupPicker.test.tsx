// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { PopupPicker, type PickerSection } from "./PopupPicker";

const SECTIONS: PickerSection[] = [
  { title: "Warm", items: [{ id: "paper", label: "Paper" }, { id: "sepia", label: "Sepia" }] },
  { title: "Cool", items: [{ id: "graphite", label: "Graphite" }] },
];

function Harness({ search }: { search?: boolean }) {
  const [value, setValue] = useState("sepia");
  return (
    <>
      <PopupPicker label="Theme" selectedId={value} sections={SECTIONS} onSelect={setValue} searchPlaceholder={search ? "Search" : undefined} />
      <output>{value}</output>
      <button type="button">Elsewhere</button>
    </>
  );
}

function trigger() {
  return screen.getByRole("button", { name: /^theme:/i });
}

describe("PopupPicker", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView ??= () => undefined;
  });
  afterEach(cleanup);

  it("names the current choice on a closed button", () => {
    render(<Harness />);
    expect(trigger().getAttribute("aria-label")).toBe("Theme: Sepia");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens on the current choice and moves with the arrow keys, skipping section titles", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const active = () => document.querySelector(".popup-picker__option--active")?.textContent;
    expect(active()).toBe("Sepia");
    await user.keyboard("{ArrowDown}");
    expect(active()).toBe("Graphite");
    await user.keyboard("{ArrowDown}");
    expect(active()).toBe("Graphite");
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(active()).toBe("Paper");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("status").textContent).toBe("paper");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes without choosing on a click outside", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("sepia");
  });

  it("filters across sections, drops empty ones, and says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Harness search />);
    await user.click(trigger());
    const search = screen.getByRole("searchbox", { name: "Search" });
    expect(document.activeElement).toBe(search);
    await user.type(search, "graph");
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Cool"]);
    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("Nothing matches.")).toBeTruthy();
  });
});
