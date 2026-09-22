// @vitest-environment jsdom
//
// The quick-note window against an in-memory app. A plain CodeMirror view stands
// in for the full editor, with the same contract: a toolbar given the view, a
// change callback, and a flush.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptureApi } from "./captureApi";
import { QuickNoteWindow } from "./QuickNoteWindow";
import { clip, fakeCaptureApi } from "./testing/fakeCaptureApi";

vi.mock("@latentic/live-markdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("@latentic/live-markdown")>();
  return { ...original, CodeMirrorMarkdownEditor: StandInEditor };
});

interface StandInProps {
  value: string;
  onChange(value: string): void;
  toolbar?(context: { view: EditorView; contributions: [] }): ReactNode;
  onFlushReady?(flush: (() => void) | null): void;
}

function StandInEditor({ value, onChange, toolbar, onFlushReady }: StandInProps) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    const created = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [EditorView.updateListener.of((update) => update.docChanged && change.current(update.state.doc.toString()))],
      }),
    });
    setView(created);
    onFlushReady?.(() => undefined);
    return () => {
      onFlushReady?.(null);
      created.destroy();
    };
    // The editor is made once per note, as the real one is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      {view && toolbar ? toolbar({ view, contributions: [] }) : null}
      <div ref={host} data-testid="editor" />
    </div>
  );
}

beforeAll(() => {
  // jsdom lays nothing out: there is no scrolling to do, and CodeMirror's
  // measure of the caret's text finds empty boxes.
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

beforeEach(() => localStorage.clear());

async function open(api: CaptureApi) {
  const rendered = render(<QuickNoteWindow api={api} />);
  await screen.findByText("Saves to My Notes");
  await waitFor(() => expect(editorView()).not.toBeNull());
  return rendered;
}

function editorView(): EditorView | null {
  const element = screen.queryByTestId("editor")?.querySelector(".cm-editor");
  return element ? EditorView.findFromDOM(element as HTMLElement) : null;
}

function type(text: string) {
  const view = editorView()!;
  act(() => view.dispatch(view.state.replaceSelection(text)));
}

function press(key: string, modifiers: Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey">> = {}) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...modifiers });
}

function selectedClip(): string {
  return screen.getByRole("option", { selected: true }).textContent ?? "";
}

describe("the quick-note window", () => {
  it("saves the note as typed with ⌘↩", async () => {
    const fake = fakeCaptureApi();
    await open(fake.api);
    type("# Shopping\n\n- eggs");
    press("Enter", { metaKey: true });
    await waitFor(() => expect(fake.saved.map((note) => note.text)).toEqual(["# Shopping\n\n- eggs"]));
  });

  it("keeps the note and closes on Esc", async () => {
    const fake = fakeCaptureApi();
    await open(fake.api);
    type("Half a thought");
    press("Escape");
    await waitFor(() => expect(fake.api.close).toHaveBeenCalled());
    expect([...fake.notes.values()].map((note) => note.body)).toEqual(["Half a thought"]);
  });

  it("formats the selection from its toolbar", async () => {
    const fake = fakeCaptureApi();
    await open(fake.api);
    type("important");
    const view = editorView()!;
    act(() => view.dispatch({ selection: EditorSelection.range(0, 9) }));
    fireEvent.click(screen.getByRole("button", { name: "Bold (⌘B)" }));
    expect(view.state.doc.toString()).toBe("**important**");
  });

  it("holds several notes: ⌘N starts one, and the list switches between them", async () => {
    const fake = fakeCaptureApi({ notes: [{ id: "a", body: "Groceries", createdAt: 1, updatedAt: 1 }] });
    await open(fake.api);
    press("n", { metaKey: true });
    await waitFor(() => expect(screen.getAllByRole("button", { name: /New note|Groceries/ })).toHaveLength(3));
    type("Call Ada");
    fireEvent.click(screen.getByRole("button", { name: /Groceries/ }));
    await waitFor(() => expect(editorView()?.state.doc.toString()).toBe("Groceries"));
  });

  it("puts the caret in a new note, from ⌘N or the New note button, so typing goes into it", async () => {
    const fake = fakeCaptureApi({ notes: [{ id: "a", body: "Groceries", createdAt: 1, updatedAt: 1 }] });
    await open(fake.api);
    const groceries = editorView();
    press("n", { metaKey: true });
    await waitFor(() => expect(editorView()).not.toBe(groceries));
    expect(editorView()?.hasFocus).toBe(true);

    type("Call Ada");
    const callAda = editorView();
    fireEvent.click(screen.getByRole("button", { name: /⌘N/ }));
    await waitFor(() => expect(editorView()).not.toBe(callAda));
    expect(editorView()?.hasFocus).toBe(true);

    act(() => (document.activeElement as HTMLElement).blur());
    press("n", { metaKey: true });
    await waitFor(() => expect(editorView()?.hasFocus).toBe(true));
  });

  it("opens a note picked from the list, stepped to, or next after a save with the caret at its end", async () => {
    const fake = fakeCaptureApi({
      notes: [
        { id: "b", body: "Call Ada", createdAt: 2, updatedAt: 2 },
        { id: "a", body: "# Groceries\n\n- eggs", createdAt: 1, updatedAt: 1 },
      ],
    });
    await open(fake.api);
    const caretAtEnd = (body: string) => {
      const view = editorView();
      expect(view?.state.doc.toString()).toBe(body);
      expect(view?.hasFocus).toBe(true);
      expect(view?.state.selection.main.head).toBe(body.length);
    };

    const groceries = screen.getByRole("button", { name: /Groceries/ });
    expect(fireEvent.mouseDown(groceries)).toBe(false);
    fireEvent.click(groceries);
    await waitFor(() => caretAtEnd("# Groceries\n\n- eggs"));
    press("ArrowUp", { ctrlKey: true, metaKey: true });
    await waitFor(() => caretAtEnd("Call Ada"));
    press("Enter", { metaKey: true });
    await waitFor(() => caretAtEnd("# Groceries\n\n- eggs"));
  });

  it("asks before deleting a note that has not been saved", async () => {
    const fake = fakeCaptureApi({ notes: [{ id: "a", body: "Keep me?", createdAt: 1, updatedAt: 1 }] });
    await open(fake.api);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alert").textContent).toContain("Delete this note? It has not been saved.");
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(fake.api.deleteNote).toHaveBeenCalledWith("a"));
  });
});

describe("the clipboard in the quick-note window", () => {
  it("is off until turned on, and says what it keeps", async () => {
    const fake = fakeCaptureApi({ historyOn: false, clips: [clip("c1", "Copied earlier")] });
    await open(fake.api);
    fireEvent.click(screen.getByRole("tab", { name: "Clipboard" }));
    expect(screen.getByText(/What password managers copy is never kept/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on clipboard history" }));
    await screen.findByText("Copied earlier");
    expect(fake.api.clipboard.setEnabled).toHaveBeenCalledWith(true);
  });

  it("opens on the clipboard when that shortcut is pressed, and shows new copies as they come", async () => {
    const fake = fakeCaptureApi({ clips: [clip("c1", "First copy")] });
    await open(fake.api);
    act(() => fake.show("clipboard"));
    await screen.findByText("First copy");
    act(() => fake.copy(clip("c2", "Just copied")));
    await screen.findByText("Just copied");
  });

  it("opens on the newest copy with the search cleared, whichever entry was picked before", async () => {
    const fake = fakeCaptureApi({ clips: [clip("c1", "Newest"), clip("c2", "Older")] });
    await open(fake.api);
    act(() => fake.show("clipboard"));
    await waitFor(() => expect(selectedClip()).toContain("Newest"));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    expect(selectedClip()).toContain("Older");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "old" } });

    act(() => fake.show("notes"));
    act(() => fake.show("clipboard"));
    await waitFor(() => expect(selectedClip()).toContain("Newest"));
    expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("");
  });

  it("selects the newest copy rather than a pinned entry listed above it, so Return pastes what was copied last", async () => {
    const fake = fakeCaptureApi({ clips: [clip("c1", "Just copied"), clip("c2", "Pinned address", { pinned: true })] });
    await open(fake.api);
    act(() => fake.show("clipboard"));
    await waitFor(() => expect(selectedClip()).toContain("Just copied"));
    expect(screen.getAllByRole("option")[0]?.textContent).toContain("Pinned address");
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    await waitFor(() => expect(fake.api.clipboard.copy).toHaveBeenCalledWith("c1"));
  });

  it("moves to each new copy while the newest is selected, and stays on an entry the user picked", async () => {
    const fake = fakeCaptureApi({ clips: [clip("c1", "First copy"), clip("c2", "Earlier")] });
    await open(fake.api);
    act(() => fake.show("clipboard"));
    await waitFor(() => expect(selectedClip()).toContain("First copy"));
    act(() => fake.copy(clip("c3", "Second copy")));
    await waitFor(() => expect(selectedClip()).toContain("Second copy"));

    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    act(() => fake.copy(clip("c4", "Third copy")));
    await screen.findByText("Third copy");
    expect(selectedClip()).toContain("First copy");
  });

  it("keeps the keyboard in the search box when an entry is clicked, so Return copies that entry", async () => {
    const fake = fakeCaptureApi({ clips: [clip("c1", "Newest"), clip("c2", "Older")] });
    await open(fake.api);
    act(() => fake.show("clipboard"));
    const older = (await screen.findByText("Older")).closest("li")!;
    expect(fireEvent.mouseDown(older)).toBe(false);
    fireEvent.click(older);
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    await waitFor(() => expect(fake.api.clipboard.copy).toHaveBeenCalledWith("c2"));
  });

  it("copies an entry back and closes on Return, to paste where the user was", async () => {
    const fake = fakeCaptureApi({ clips: [clip("c1", "Paste me")] });
    await open(fake.api);
    act(() => fake.show("clipboard"));
    await screen.findByText("Paste me");
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    await waitFor(() => expect(fake.api.close).toHaveBeenCalled());
    expect(fake.api.clipboard.copy).toHaveBeenCalledWith("c1");
  });

  it("puts an entry into the note with ⌘↩, formatting converted to Markdown", async () => {
    const fake = fakeCaptureApi({ clips: [clip("c1", "Bold words", { html: "<p><strong>Bold</strong> words</p>" })] });
    await open(fake.api);
    type("Note: ");
    act(() => fake.show("clipboard"));
    await screen.findByText("Bold words");
    press("Enter", { metaKey: true });
    await waitFor(() => expect(editorView()?.state.doc.toString()).toBe("Note: **Bold** words"));
    expect(screen.getByRole("tab", { name: /Notes/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("starts a new note from an entry with ⌘N", async () => {
    const fake = fakeCaptureApi({ clips: [clip("c1", "https://example.com/article", { kind: "link" })] });
    await open(fake.api);
    act(() => fake.show("clipboard"));
    await screen.findByText("https://example.com/article");
    press("n", { metaKey: true });
    await waitFor(() => expect(editorView()?.state.doc.toString()).toBe("<https://example.com/article>"));
  });

  it("says how to let Compose read other apps' copies when macOS asks first, until it is allowed", async () => {
    const fake = fakeCaptureApi({ clips: [clip("c1", "Copied earlier")], access: "asks" });
    await open(fake.api);
    act(() => fake.show("clipboard"));
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(/macOS asks before Compose reads what other apps copy/);
    expect(screen.getByText("Copied earlier")).toBeTruthy();

    fireEvent.click(within(notice).getByRole("button", { name: "Open Privacy & Security" }));
    expect(fake.api.clipboard.openPrivacySettings).toHaveBeenCalled();

    act(() => fake.setAccess("allowed"));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("finds entries by what they say", async () => {
    const fake = fakeCaptureApi({ clips: [clip("c1", "Tomato soup"), clip("c2", "Bread")] });
    await open(fake.api);
    act(() => fake.show("clipboard"));
    await screen.findByText("Bread");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "tomato" } });
    await waitFor(() => expect(screen.queryByText("Bread")).toBeNull());
    expect(screen.getByText("Tomato soup")).toBeTruthy();
  });
});
