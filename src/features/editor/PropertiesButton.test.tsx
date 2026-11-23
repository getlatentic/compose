// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyFileBuffer, createWorkspaceFromPath, openWorkspaceFile, type Workspace } from "../../app/workspaceModel";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { PropertiesButton } from "./PropertiesButton";

function seed(content: string, focusedArea: "workspace" | "loose" = "workspace") {
  let workspace: Workspace = {
    ...createWorkspaceFromPath("/tmp/notes"),
    id: "ws",
    scanState: "ready",
    files: [{ relativePath: "a.md", lastModifiedMs: 1, sizeBytes: 1 }],
  };
  workspace = openWorkspaceFile(applyFileBuffer(workspace, "a.md", { content, lastModifiedMs: 1 }), "a.md");
  useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: "ws", focusedArea, navHistory: [], navIndex: -1, newNoteDir: "" });
}

describe("PropertiesButton", () => {
  beforeEach(() => seed("---\nstatus: draft\ntags: [a, b]\n---\n# Note\n"));
  afterEach(cleanup);

  it("says how many fields the note has", () => {
    render(<PropertiesButton />);
    const button = screen.getByRole("button", { name: /Properties/ });
    expect(button.querySelector(".properties-button__count")?.textContent).toBe("2");
  });

  it("opens the note's properties in a popover above it", async () => {
    const user = userEvent.setup();
    render(<PropertiesButton />);
    await user.click(screen.getByRole("button", { name: /Properties/ }));
    const popover = screen.getByRole("dialog", { name: "Properties" });
    expect(popover.style.bottom).not.toBe("");
    expect(popover.textContent).toContain("status");
    expect(screen.getByRole("button", { name: /Properties/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("shows no count for a note without properties, and nothing while another file is in the editor", () => {
    seed("# Plain note\n");
    const { unmount } = render(<PropertiesButton />);
    expect(document.querySelector(".properties-button__count")).toBeNull();
    unmount();
    seed("---\nstatus: draft\n---\n", "loose");
    render(<PropertiesButton />);
    expect(screen.queryByRole("button", { name: /Properties/ })).toBeNull();
  });
});
