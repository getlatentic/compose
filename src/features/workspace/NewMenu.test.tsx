// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewMenu } from "./NewMenu";

afterEach(cleanup);

function renderMenu(tab: "files" | "chat" = "files") {
  const handlers = { onNewNote: vi.fn(), onNewFolder: vi.fn(), onNewChat: vi.fn() };
  render(<NewMenu tab={tab} disabled={false} {...handlers} />);
  return handlers;
}

function rowLabels(): string[] {
  return screen.getAllByRole("menuitem").map((row) => row.querySelector(".new-menu__item-label")?.textContent ?? "");
}

describe("NewMenu", () => {
  it("opens upward from the + with an icon, label and shortcut per row, leading with the tab's subject", async () => {
    const user = userEvent.setup();
    renderMenu("files");
    await user.click(screen.getByRole("button", { name: "New" }));
    const panel = screen.getByRole("menu", { name: "New" });
    expect(panel.style.bottom).not.toBe("");
    expect(panel.style.top).toBe("");
    expect(rowLabels()).toEqual(["New note", "New folder", "New chat"]);
    expect(panel.querySelectorAll(".new-menu__item-icon")).toHaveLength(3);
    expect(screen.getByRole("menuitem", { name: /New note/ }).textContent).toContain("⌘N");
  });

  it("leads with New chat on the Chat tab", async () => {
    const user = userEvent.setup();
    renderMenu("chat");
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(rowLabels()[0]).toBe("New chat");
  });

  it("moves with the arrow keys, wrapping, and runs the chosen row then closes", async () => {
    const user = userEvent.setup();
    const handlers = renderMenu("files");
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /New note/ }));
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /New chat/ }));
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /New folder/ }));
    await user.keyboard("{Enter}");
    expect(handlers.onNewFolder).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
