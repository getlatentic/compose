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
  // jsdom lays nothing out, so it has no scrolling to do.
  Element.prototype.scrollIntoView = vi.fn();
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
