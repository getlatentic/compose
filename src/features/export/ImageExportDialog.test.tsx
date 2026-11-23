// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ImageExportDialog } from "./ImageExportDialog";

const NOTE = "---\ncategory: Graduate Mathematics\nauthor: Ada\n---\n# A theorem\n\nPrime sums.";

describe("ImageExportDialog", () => {
  it("opens on a portrait page, as a note naturally reads", () => {
    render(<ImageExportDialog markdown={NOTE} filePath="notes/theorem.md" selection="" onClose={vi.fn()} onResult={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Page" })).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Size")).toHaveProperty("value", "portrait");
    expect(screen.getByRole("checkbox", { name: "Compose mark" })).toHaveProperty("checked", true);
  });

  it("offers to copy, share or post the image beside saving it", () => {
    render(<ImageExportDialog markdown={NOTE} filePath="a.md" selection="" onClose={vi.fn()} onResult={vi.fn()} />);
    const share = screen.getByRole("group", { name: "Share" });
    for (const name of ["Copy image", "Share…", "Post on X"]) {
      expect(within(share).getByRole("button", { name })).toBeTruthy();
    }
  });

  it("lets the card take a colour of its own, apart from the note's", async () => {
    const user = userEvent.setup();
    render(<ImageExportDialog markdown={NOTE} filePath="a.md" selection="" onClose={vi.fn()} onResult={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Like the note" })).toHaveProperty("checked", true);
    expect(screen.queryByLabelText("Card colour, hex")).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Colour" }));
    expect(screen.getByRole("button", { name: "Yellow" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Sage" }));
    expect(screen.getByLabelText("Card colour, hex")).toHaveProperty("value", "#DFE8D8");
  });

  it("fills a cover from the note, and each layout shows its own fields", async () => {
    const user = userEvent.setup();
    render(<ImageExportDialog markdown={NOTE} filePath="notes/theorem.md" selection="" onClose={vi.fn()} onResult={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: "Cover" }));
    expect(screen.getByLabelText("Label")).toHaveProperty("value", "Graduate Mathematics");
    expect(screen.getByLabelText("Title")).toHaveProperty("value", "A theorem");
    await user.click(screen.getByRole("radio", { name: "Quote" }));
    expect(screen.getByLabelText("Passage")).toHaveProperty("value", "Prime sums.");
    expect(screen.queryByLabelText("Label")).toBeNull();
  });

  it("starts on a quote of the selection when there is one", () => {
    render(<ImageExportDialog markdown={NOTE} filePath="a.md" selection="A chosen line" onClose={vi.fn()} onResult={vi.fn()} />);
    expect(screen.getByLabelText("Passage")).toHaveProperty("value", "A chosen line");
  });

  it("closes on Cancel", async () => {
    const onClose = vi.fn();
    render(<ImageExportDialog markdown={NOTE} filePath="a.md" selection="" onClose={onClose} onResult={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("reports a failed export and lets the writer try again", async () => {
    const onResult = vi.fn();
    render(<ImageExportDialog markdown={NOTE} filePath="a.md" selection="" onClose={vi.fn()} onResult={onResult} />);
    const exportButton = screen.getByRole("button", { name: "Export…" });
    await userEvent.setup().click(exportButton);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
    expect(screen.getByRole("button", { name: "Export…" })).toHaveProperty("disabled", false);
  });

  it("says where the preview is drawn when there is no renderer", async () => {
    render(<ImageExportDialog markdown={NOTE} filePath="a.md" selection="" onClose={vi.fn()} onResult={vi.fn()} />);
    expect(await screen.findByText("The preview draws in the Compose app.")).toBeTruthy();
  });
});
