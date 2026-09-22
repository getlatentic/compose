// The quick-note window in WebKit, the engine it ships on, with the real editor:
// where focus goes after a click or a shortcut is the engine's call, and jsdom
// moves no focus on a click at all.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";

import "@latentic/live-markdown/styles.css";
import "./quickCapture.css";
import { QuickNoteWindow } from "./QuickNoteWindow";
import { clip, fakeCaptureApi } from "./testing/fakeCaptureApi";

afterEach(cleanup);

/** Waits for the note editor to show `body`, and returns it. */
async function editorShowing(body: string): Promise<EditorView> {
  let view: EditorView | null = null;
  await waitFor(() => {
    const element = document.querySelector<HTMLElement>(".quick-note__editor .cm-editor");
    view = element ? EditorView.findFromDOM(element) : null;
    expect(view?.state.doc.toString()).toBe(body);
  });
  return view!;
}

function selectedClip(): string {
  return screen.getByRole("option", { selected: true }).textContent ?? "";
}

describe("the quick-note window in WebKit", () => {
  it("types into each note that comes up: after ⌘N, the New note button, or a click in the list", async () => {
    const fake = fakeCaptureApi({ notes: [{ id: "a", body: "Groceries", createdAt: 1, updatedAt: 1 }] });
    render(<QuickNoteWindow api={fake.api} />);
    await editorShowing("Groceries");

    await userEvent.keyboard("{Meta>}n{/Meta}");
    await editorShowing("");
    await userEvent.keyboard("Call Ada");
    await editorShowing("Call Ada");

    await userEvent.click(screen.getByRole("button", { name: /⌘N/ }));
    await editorShowing("");
    await userEvent.keyboard("Buy bread");
    await editorShowing("Buy bread");

    await userEvent.click(screen.getByRole("button", { name: /Groceries/ }));
    await editorShowing("Groceries");
    await userEvent.keyboard(" and eggs");
    await editorShowing("Groceries and eggs");
  });

  it("keeps what was typed a moment before moving to another note", async () => {
    const fake = fakeCaptureApi({
      notes: [
        { id: "b", body: "Second", createdAt: 2, updatedAt: 2 },
        { id: "a", body: "First", createdAt: 1, updatedAt: 1 },
      ],
    });
    render(<QuickNoteWindow api={fake.api} />);
    await editorShowing("Second");
    await userEvent.keyboard(" draft");
    await userEvent.click(screen.getByRole("button", { name: /First/ }));
    await editorShowing("First");
    await userEvent.click(screen.getByRole("button", { name: /Second/ }));
    await editorShowing("Second draft");
  });

  it("keeps the keyboard in the search box when an entry is clicked", async () => {
    const fake = fakeCaptureApi({ clips: [clip("c1", "Newest"), clip("c2", "Older"), clip("c3", "Oldest")] });
    render(<QuickNoteWindow api={fake.api} />);
    await editorShowing("");
    act(() => fake.show("clipboard"));
    const search = await screen.findByRole("searchbox");
    await waitFor(() => expect(document.activeElement).toBe(search));

    await userEvent.click(await screen.findByText("Oldest"));
    expect(selectedClip()).toContain("Oldest");
    expect(document.activeElement).toBe(search);
    await userEvent.keyboard("{ArrowUp}");
    await waitFor(() => expect(selectedClip()).toContain("Older"));
  });
});
