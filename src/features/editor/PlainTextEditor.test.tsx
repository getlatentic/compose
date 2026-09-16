// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PLAIN_TEXT_BUFFER_DEBOUNCE_MS, PlainTextEditor } from "./PlainTextEditor";

// jsdom has no layout, and CodeMirror measures text ranges after each update.
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

function viewIn(container: HTMLElement): EditorView {
  const content = container.querySelector(".cm-content");
  const view = content ? EditorView.findFromDOM(content as HTMLElement) : null;
  if (!view) throw new Error("no editor mounted");
  return view;
}

function type(view: EditorView, text: string) {
  view.dispatch({ changes: { from: view.state.doc.length, insert: text }, userEvent: "input.type" });
}

function press(view: EditorView, key: string, modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {}) {
  return runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...modifiers }), "editor");
}

describe("the plain-text editor", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the file exactly as written", () => {
    const text = "---\ntitle: not front matter\n---\n# not a heading\n**not bold**\n";
    const { container } = render(<PlainTextEditor value={text} onChange={vi.fn()} />);
    expect(viewIn(container).state.doc.toString()).toBe(text);
  });

  it("hands an edit to the buffer once typing pauses", () => {
    const onChange = vi.fn();
    const { container } = render(<PlainTextEditor value="milk" onChange={onChange} />);
    const view = viewIn(container);

    type(view, "\neggs");
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(PLAIN_TEXT_BUFFER_DEBOUNCE_MS));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("milk\neggs");
  });

  it("flushes a pending edit at once, and only when there is one", () => {
    const onChange = vi.fn();
    let flush: (() => void) | null = null;
    const { container } = render(
      <PlainTextEditor value="milk" onChange={onChange} onFlushReady={(fn) => (flush = fn)} />,
    );

    flush!();
    expect(onChange).not.toHaveBeenCalled();

    type(viewIn(container), "!");
    flush!();
    expect(onChange).toHaveBeenCalledWith("milk!");
    act(() => vi.advanceTimersByTime(PLAIN_TEXT_BUFFER_DEBOUNCE_MS));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("takes content changed elsewhere without echoing it back as an edit", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<PlainTextEditor value="milk" onChange={onChange} />);

    rerender(<PlainTextEditor value={"milk\nbread"} onChange={onChange} />);
    act(() => vi.advanceTimersByTime(PLAIN_TEXT_BUFFER_DEBOUNCE_MS));

    expect(viewIn(container).state.doc.toString()).toBe("milk\nbread");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("has no Markdown shortcuts", () => {
    const { container } = render(<PlainTextEditor value="word" onChange={vi.fn()} />);
    const view = viewIn(container);
    view.dispatch({ selection: { anchor: 0, head: 4 } });

    expect(press(view, "b", { metaKey: true })).toBe(false);
    expect(press(view, "b", { ctrlKey: true })).toBe(false);
    expect(view.state.doc.toString()).toBe("word");
  });

  it("types a tab character on Tab", () => {
    const { container } = render(<PlainTextEditor value="a" onChange={vi.fn()} />);
    const view = viewIn(container);
    view.dispatch({ selection: { anchor: 1 } });

    expect(press(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe("a\t");
  });

  it("stops saying it can flush once it is gone", () => {
    const onFlushReady = vi.fn();
    const { unmount } = render(<PlainTextEditor value="" onChange={vi.fn()} onFlushReady={onFlushReady} />);
    unmount();
    expect(onFlushReady).toHaveBeenLastCalledWith(null);
  });
});
